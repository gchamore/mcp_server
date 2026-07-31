import { AxonautClient } from './client.js';
import { axonautTools, type AxonautCredentials } from './tools.js';
import { defineConnector } from '../types.js';
import { errorMessage } from '../../core/errors.js';

/**
 * Connecteur Axonaut — CRM et facturation.
 *
 * Ce fichier est le seul point d'entrée vu par la plateforme : le registre le
 * découvre automatiquement grâce au nom du dossier.
 */
export default defineConnector<AxonautCredentials>({
  id: 'axonaut',
  name: 'Axonaut',
  tagline: 'CRM, devis et facturation pour TPE/PME',
  description:
    "Donne à votre assistant IA un accès en lecture et en écriture à votre compte Axonaut : entreprises, contacts, devis, factures, projets et dépenses. Idéal pour interroger votre portefeuille clients ou suivre les impayés en langage naturel.",
  category: 'crm',
  status: 'stable',
  icon: 'https://www.axonaut.com/favicon.ico',
  accentColor: '#2563eb',
  docsUrl: 'https://axonaut.com/api/v2/doc',

  auth: {
    type: 'api_key',
    instructions:
      'Dans Axonaut : Paramètres → Extensions & API → API. Copiez la clé « userApiKey ».',
    docsUrl: 'https://axonaut.com/api/v2/doc',
    fields: [
      {
        key: 'apiKey',
        label: 'Clé API Axonaut',
        type: 'password',
        required: true,
        placeholder: 'Collez votre clé userApiKey',
        help: 'La clé est chiffrée avant stockage et n’est jamais réaffichée en clair.',
        minLength: 10,
        maxLength: 200,
      },
    ],
  },

  async verify(credentials, ctx) {
    try {
      const account = await new AxonautClient(credentials.apiKey, ctx.signal).getAccount();
      const label = account.company_name ?? account.name ?? account.email ?? undefined;
      return label ? { ok: true, accountLabel: label } : { ok: true };
    } catch (error) {
      ctx.logger.debug({ err: error }, 'Vérification Axonaut échouée');
      return { ok: false, message: errorMessage(error) };
    }
  },

  tools: axonautTools,
});
