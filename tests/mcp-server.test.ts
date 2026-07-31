import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConnectors, requireConnector } from '../src/connectors/registry.js';
import { buildMcpServer } from '../src/mcp/server-factory.js';
import type { ConnectorDefinition } from '../src/connectors/types.js';

/**
 * Vérifie que le serveur MCP construit depuis un connecteur est réellement
 * conforme : un vrai client du SDK s'y connecte, liste les outils et en appelle
 * un. C'est ce qui manquait à l'ancienne implémentation, où le JSON-RPC était
 * réécrit à la main et divergeait du SDK.
 */

await loadConnectors();

async function connect(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connector: ConnectorDefinition<any>,
  calls: { toolName: string; success: boolean }[] = [],
) {
  const server = buildMcpServer(connector, {
    connectionId: 'connexion-test',
    connectorId: connector.id,
    endpointId: 'endpoint-test',
    credentials: { apiKey: 'cle-de-test' },
    onToolCall: (event) => calls.push({ toolName: event.toolName, success: event.success }),
  });

  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, close: async () => Promise.all([client.close(), server.close()]) };
}

describe('serveur MCP', () => {
  it('expose tous les outils du connecteur avec leur schéma', async () => {
    const connector = requireConnector('axonaut');
    const { client, close } = await connect(connector);

    const { tools } = await client.listTools();

    expect(tools).toHaveLength(connector.tools.length);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toHaveProperty('type', 'object');
    }
    // Les annotations de lecture seule sont transmises aux clients.
    const listCompanies = tools.find((tool) => tool.name === 'list_companies');
    expect(listCompanies?.annotations?.readOnlyHint).toBe(true);

    await close();
  });

  it('transmet une erreur d’outil sans faire tomber la session', async () => {
    // L'appel réseau échouera (clé factice) : le serveur doit répondre par un
    // résultat `isError`, jamais par une exception de transport.
    const calls: { toolName: string; success: boolean }[] = [];
    const { client, close } = await connect(requireConnector('axonaut'), calls);

    const result = await client.callTool({
      name: 'list_companies',
      arguments: { page: 1 },
    });

    expect(result.isError).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(calls.at(-1)).toMatchObject({ toolName: 'list_companies', success: false });

    // La session reste utilisable après l'échec.
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    await close();
  }, 30_000);

  it('signale un outil inconnu sans couper la connexion', async () => {
    const { client, close } = await connect(requireConnector('brevo'));

    // Conformément à la spécification MCP, un outil inconnu remonte en tant que
    // résultat d'appel en erreur, et non en exception de transport.
    const result = await client.callTool({ name: 'outil_inexistant', arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('outil_inexistant');

    await close();
  });
});
