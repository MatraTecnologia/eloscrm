import * as graph from "./graph.js";

export type MetaGraphClient = typeof graph;

/**
 * Indireção para o teste: `vi.mock` deste módulo substitui a Graph API inteira, do mesmo jeito que
 * `createUazapiClient` é a única costura da integração de WhatsApp.
 */
export const createMetaGraphClient = (): MetaGraphClient => graph;

export { MetaGraphError } from "./graph.js";
export type { MetaFieldDatum, MetaFormNode, MetaLeadNode, MetaPageNode } from "./graph.js";
