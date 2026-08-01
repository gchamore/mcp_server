import type { ConnectorSummary } from '../connectors/types.js';
import type { ConnectionView } from '../modules/connections/connection.service.js';
import type { PublicUser } from '../modules/auth/auth.service.js';
import type { ConsentView } from '../modules/oauth/consent.service.js';
import type * as Contrat from './api-types.js';

/**
 * ===========================================================================
 *  Conformité du serveur au contrat d'API
 * ===========================================================================
 *
 * Déplacer les types dans un fichier commun supprime la *recopie*, pas la
 * *dérive* : rien n'empêchait encore de modifier une projection du serveur sans
 * toucher au contrat. Le navigateur aurait continué de compiler, en attendant
 * un champ que le serveur n'envoie plus.
 *
 * Ce fichier ferme cet écart. Il ne produit aucun code — uniquement des
 * assertions de types, évaluées à la compilation. Si une projection cesse de
 * satisfaire ce que l'interface attend, `npm run typecheck` échoue, en
 * désignant la ligne exacte.
 *
 * Le sens de l'assertion est délibéré : on vérifie que le serveur **fournit au
 * moins** ce que le contrat annonce. Ajouter un champ côté serveur est sans
 * danger — l'interface l'ignore. En retirer un, ou en changer le type, casse la
 * compilation. C'est exactement la dissymétrie voulue.
 */

/** Échoue à la compilation si `T` n'est pas exactement `true`. */
type Assert<T extends true> = T;

/**
 * Ce qu'un type devient une fois passé par `res.json()`.
 *
 * Le serveur manipule des `Date` ; le navigateur reçoit des chaînes ISO. La
 * première version de ce fichier comparait le type interne au contrat et
 * signalait donc une dérive sur chaque champ de date — un faux positif, mais
 * qui pointait une vraie subtilité : le modèle du domaine et le format
 * transporté ne sont pas le même type.
 *
 * Cette transformation le rend explicite, au lieu de le laisser dans la tête de
 * celui qui écrit le contrat.
 */
type Serialise<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialise<U>[]
    : T extends object
      ? { [K in keyof T]: Serialise<T[K]> }
      : T;

/** `A`, une fois sérialisé, couvre-t-il tout ce que `B` exige ? */
type Fournit<A, B> = Serialise<A> extends B ? true : false;

// --- Catalogue --------------------------------------------------------------

type _Connecteur = Assert<Fournit<ConnectorSummary, Contrat.Connector>>;

// --- Connexions -------------------------------------------------------------

type _Connexion = Assert<Fournit<ConnectionView, Contrat.Connection>>;

// --- Comptes ----------------------------------------------------------------

type _Utilisateur = Assert<Fournit<PublicUser, Contrat.User>>;

// --- Écran de consentement --------------------------------------------------

type _Consentement = Assert<Fournit<ConsentView, Contrat.ConsentView>>;

/**
 * Les alias ci-dessus ne sont référencés nulle part : c'est leur évaluation qui
 * porte la vérification. Cet export les rend visibles pour `noUnusedLocals`
 * sans rien ajouter au code produit.
 */
export type ConformiteVerifiee = [_Connecteur, _Connexion, _Utilisateur, _Consentement];
