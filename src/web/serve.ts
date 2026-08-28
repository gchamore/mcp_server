import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import { getConnector, listConnectors } from '../connectors/registry.js';
import { env } from '../core/env.js';
import { logger } from '../core/logger.js';

/**
 * Service de l'interface web.
 *
 * Trois responsabilités que l'on gagne à traiter ensemble, parce qu'elles
 * portent toutes sur la même réponse HTML ou sur les mêmes fichiers :
 *
 * 1. servir les variantes précompressées (`.br`, `.gz`) produites au build ;
 * 2. injecter les métadonnées propres à chaque route dans le `<head>` ;
 * 3. renvoyer une vraie 404 pour un fichier absent, au lieu d'un index.html
 *    déguisé — un `robots.txt` qui répond du HTML en 200 est pire que rien.
 */

const WEB_ROOT = path.resolve(process.cwd(), 'web', 'dist');

// --- 1. Variantes précompressées -------------------------------------------

const ENCODINGS = [
  { suffix: '.br', token: 'br' },
  { suffix: '.gz', token: 'gzip' },
] as const;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/**
 * Réécrit l'URL vers `fichier.br` quand le client sait la lire.
 *
 * Le `Content-Type` doit être posé à la main : `express.static` le déduirait
 * de l'extension `.br` et servirait du `application/x-brotli`, que le
 * navigateur téléchargerait au lieu de l'exécuter.
 *
 * `Vary: Accept-Encoding` est indispensable — sans lui, un cache partagé
 * servirait du brotli à un client qui ne le comprend pas.
 */
function precompressed(): RequestHandler {
  return (req, res, next) => {
    const accepted = req.headers['accept-encoding'];

    // HEAD compte autant que GET : sa réponse doit annoncer exactement les
    // en-têtes du GET correspondant, sinon un cache intermédiaire — ou un
    // simple `curl -I` — voit une taille et un encodage qui ne correspondent
    // pas à ce qui sera réellement servi.
    if (typeof accepted !== 'string' || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return next();
    }

    const extension = path.extname(req.path);
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) return next();

    for (const { suffix, token } of ENCODINGS) {
      if (!accepted.includes(token)) continue;

      const candidate = path.join(WEB_ROOT, `${req.path}${suffix}`);
      if (!candidate.startsWith(WEB_ROOT) || !existsSync(candidate)) continue;

      req.url = `${req.path}${suffix}`;
      res.setHeader('Content-Encoding', token);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Vary', 'Accept-Encoding');
      return next();
    }

    res.setHeader('Vary', 'Accept-Encoding');
    return next();
  };
}

// --- 2. Métadonnées par route ----------------------------------------------

interface PageMeta {
  title: string;
  description: string;
  /** Les écrans applicatifs et les tunnels d'authentification n'ont rien à faire dans un index. */
  noindex?: boolean;
}

const SITE_NAME = 'Toolink';

const STATIC_PAGES: Record<string, PageMeta> = {
  '/': {
    title: 'Toolink — Vos outils métier, pilotés par votre IA',
    description:
      'Branchez CRM, facturation et e-mailing à Claude, Dust ou ChatGPT. Une URL à coller, vos identifiants chiffrés, aucun accès partagé.',
  },
  '/catalogue': {
    title: `Catalogue des connecteurs — ${SITE_NAME}`,
    description:
      'Tous les services disponibles en Model Context Protocol : les outils exposés, les autorisations demandées, et la marche à suivre pour les brancher.',
  },
  '/connexion': { title: `Connexion — ${SITE_NAME}`, description: 'Accédez à vos connecteurs.', noindex: true },
  '/inscription': {
    title: `Créer un compte — ${SITE_NAME}`,
    description: 'Créez votre compte et branchez votre premier outil en deux minutes.',
  },
  '/mot-de-passe-oublie': { title: `Mot de passe oublié — ${SITE_NAME}`, description: '', noindex: true },
  '/reinitialiser-mot-de-passe': { title: `Nouveau mot de passe — ${SITE_NAME}`, description: '', noindex: true },
  '/autoriser': { title: `Autoriser l’accès — ${SITE_NAME}`, description: '', noindex: true },
  '/connexions': { title: `Mes connexions — ${SITE_NAME}`, description: '', noindex: true },
  '/parametres': { title: `Paramètres — ${SITE_NAME}`, description: '', noindex: true },
  '/administration': { title: `Administration — ${SITE_NAME}`, description: '', noindex: true },
};

/**
 * Les fiches connecteur méritent leurs propres métadonnées : c'est ce qui
 * s'affiche quand quelqu'un colle le lien dans Slack ou LinkedIn, et une
 * vignette générique y perd tout son sens.
 */
function metaFor(pathname: string): PageMeta {
  const known = STATIC_PAGES[pathname];
  if (known) return known;

  const match = /^\/catalogue\/([a-z0-9-]+)$/.exec(pathname);
  const connector = match?.[1] ? getConnector(match[1]) : undefined;
  if (connector) {
    return {
      title: `${connector.name} — connecteur MCP | ${SITE_NAME}`,
      description: `${connector.tagline} ${connector.description}`.trim().slice(0, 200),
    };
  }

  return { title: SITE_NAME, description: STATIC_PAGES['/']!.description, noindex: true };
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Description structurée du service.
 *
 * Sans elle, un moteur doit deviner ce qu'est ce site à partir du texte ; avec
 * elle, il le sait. Émise seulement sur la page d'accueil : la répéter sur
 * chaque route la dévaluerait.
 */
function jsonLd(): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: env.baseUrl,
    description: STATIC_PAGES['/']!.description,
    featureList: listConnectors().map((connector) => `Connecteur ${connector.name}`),
  });
}

// --- 3. Assemblage du document ---------------------------------------------

/**
 * Le squelette produit par Vite, lu une fois.
 *
 * En développement l'interface n'est pas construite : on renvoie alors une
 * chaîne vide et l'appelant sert un message explicite.
 */
const template = (() => {
  const file = path.join(WEB_ROOT, 'index.html');
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
})();

/**
 * Précharge la police de texte.
 *
 * Le navigateur ne découvre le woff2 qu'après avoir téléchargé puis analysé la
 * feuille de styles : deux allers-retours pendant lesquels le texte s'affiche
 * dans la police système, puis saute. Le préchargement supprime ce saut.
 * Restreint à la police de texte — celle de code n'apparaît qu'en dessous de
 * la ligne de flottaison.
 */
const fontPreload = (() => {
  if (!template) return '';

  // Le woff2 n'est référencé que depuis la feuille de styles : il faut aller le
  // chercher dans le dossier d'assets, pas dans le gabarit HTML.
  const dir = path.join(WEB_ROOT, 'assets');
  if (!existsSync(dir)) return '';

  const file = readdirSync(dir).find((name) =>
    /^geist-latin-wght-normal-[A-Za-z0-9_-]+\.woff2$/.test(name),
  );
  if (file) {
    return `<link rel="preload" as="font" type="font/woff2" href="/assets/${file}" crossorigin>`;
  }

  // Mieux vaut ne rien précharger qu'émettre un préchargement mort — le
  // navigateur le signale en console et la ressource est téléchargée deux fois.
  logger.warn('Police de texte introuvable dans le build : préchargement désactivé');
  return '';
})();

/**
 * Précharge le fragment de la page d'accueil.
 *
 * Le découpage par route a un coût caché : le navigateur ne découvre le
 * fragment `Landing` qu'après avoir téléchargé *puis analysé* le socle de
 * 295 ko. Deux allers-retours en série au lieu d'un en parallèle. Comme c'est
 * la première page de tout visiteur anonyme, on le lui annonce d'emblée —
 * mais seulement sur cette route, pour ne pas faire payer un fragment inutile
 * à quelqu'un qui arrive directement sur son tableau de bord.
 */
const landingPreload = (() => {
  if (!template) return '';
  const dir = path.join(WEB_ROOT, 'assets');
  if (!existsSync(dir)) return '';
  const chunk = readdirSync(dir).find((name) => /^Landing-[A-Za-z0-9_-]+\.js$/.test(name));
  return chunk ? `<link rel="modulepreload" href="/assets/${chunk}">` : '';
})();

function renderHtml(pathname: string): string | null {
  if (!template) return null;

  const meta = metaFor(pathname);
  const canonical = `${env.baseUrl}${pathname === '/' ? '' : pathname}`;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);

  const head = [
    fontPreload,
    pathname === '/' ? landingPreload : '',
    `<title>${title}</title>`,
    description ? `<meta name="description" content="${description}">` : '',
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    meta.noindex ? '<meta name="robots" content="noindex, nofollow">' : '',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${title}">`,
    description ? `<meta property="og:description" content="${description}">` : '',
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    '<meta property="og:locale" content="fr_FR">',
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${title}">`,
    description ? `<meta name="twitter:description" content="${description}">` : '',
    pathname === '/' ? `<script type="application/ld+json">${jsonLd()}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  // Le gabarit porte un titre et une description génériques : on les retire
  // pour ne pas en avoir deux, le second l'emportant selon les analyseurs.
  return template
    .replace(/<title>.*?<\/title>\s*/s, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/s, '')
    // Les commentaires du gabarit expliquent des choix aux développeurs ; ils
    // n'ont rien à faire dans une page servie des milliers de fois.
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace('</head>', `  ${head}\n  </head>`);
}

// --- 4. Fichiers pour les robots -------------------------------------------

/**
 * `robots.txt` et `sitemap.xml` sont produits à la volée plutôt que figés dans
 * `web/public` : la directive `Sitemap:` réclame une URL absolue, et le plan du
 * site doit lister les fiches connecteur. Les figer obligerait à les corriger à
 * chaque changement de domaine et à chaque connecteur ajouté — exactement le
 * genre d'oubli qu'on ne remarque que six mois plus tard.
 */
function mountRobots(app: Express): void {
  app.get('/robots.txt', (_req, res) => {
    const disallowed = Object.entries(STATIC_PAGES)
      .filter(([, meta]) => meta.noindex)
      .map(([route]) => `Disallow: ${route}`);

    res
      .type('text/plain')
      .setHeader('Cache-Control', 'public, max-age=86400')
      .send(
        [
          'User-agent: *',
          'Allow: /$',
          'Allow: /catalogue',
          ...disallowed,
          'Disallow: /api/',
          'Disallow: /mcp/',
          '',
          `Sitemap: ${env.baseUrl}/sitemap.xml`,
          '',
        ].join('\n'),
      );
  });

  app.get('/sitemap.xml', (_req, res) => {
    const routes = [
      { loc: '/', priority: '1.0' },
      { loc: '/catalogue', priority: '0.9' },
      { loc: '/inscription', priority: '0.5' },
      ...listConnectors().map((connector) => ({
        loc: `/catalogue/${connector.id}`,
        priority: '0.7',
      })),
    ];

    const urls = routes
      .map(
        ({ loc, priority }) =>
          `  <url><loc>${escapeHtml(env.baseUrl + loc)}</loc><priority>${priority}</priority></url>`,
      )
      .join('\n');

    res
      .type('application/xml')
      .setHeader('Cache-Control', 'public, max-age=86400')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });
}

// --- Montage ----------------------------------------------------------------

export function mountWeb(app: Express): void {
  mountRobots(app);
  app.use(precompressed());

  app.use(
    express.static(WEB_ROOT, {
      index: false,
      // Les noms de fichiers sont hachés par Vite : leur contenu ne peut pas
      // changer, on peut donc les mettre en cache pour un an.
      setHeaders: (res, filePath) => {
        const inAssets = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader('Cache-Control', inAssets ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );

  const sendApp = (req: Request, res: Response): void => {
    const html = renderHtml(req.path);
    if (!html) {
      res
        .status(503)
        .type('text/plain')
        .send('Interface web non construite. Lancez : npm run build:web');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  };

  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp')) {
      next();
      return;
    }

    /**
     * Une requête pour `/robots.txt` ou `/assets/x.js` qui arrive ici veut dire
     * que le fichier n'existe pas. Lui renvoyer l'application en 200 masque le
     * problème : un robot indexe du HTML comme s'il s'agissait du robots.txt,
     * et un module manquant échoue avec une erreur de syntaxe incompréhensible
     * au lieu d'un franc 404.
     */
    if (path.extname(req.path)) {
      res.status(404).type('text/plain').send('Fichier introuvable');
      return;
    }

    sendApp(req, res);
  });
}
