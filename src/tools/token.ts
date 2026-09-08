import { BaserowClient } from '../baserow-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

const PERMISSIONS_SCHEMA = {
  type: 'object',
  description:
    'Per-operation scope. Each of create/read/update/delete is true (whole workspace), false (denied), ' +
    'or an array of ["database", id] / ["table", id] pairs. Example: {"create": [["table", 1036]], "read": false, "update": false, "delete": false}',
  properties: {
    create: { description: 'true | false | [["table", id], ["database", id]]' },
    read: { description: 'true | false | [["table", id], ["database", id]]' },
    update: { description: 'true | false | [["table", id], ["database", id]]' },
    delete: { description: 'true | false | [["table", id], ["database", id]]' }
  },
  additionalProperties: false
};

export function getTokenToolSchemas(): Tool[] {
  return [
    {
      name: 'baserow_list_api_tokens',
      description:
        'List the database API tokens ("Token xxx" keys used by forms, n8n, scripts) owned by the authenticated user. Requires JWT/credentials auth.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'baserow_create_api_token',
      description:
        'Create a database API token for a workspace and return it including its key. ' +
        'If permissions are given, any operation not listed is denied; without permissions the token gets full access to the workspace. Requires JWT/credentials auth.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Token name (shown in Baserow settings)'
          },
          workspace_id: {
            type: 'number',
            description: 'Workspace the token belongs to'
          },
          permissions: PERMISSIONS_SCHEMA
        },
        required: ['name', 'workspace_id']
      }
    },
    {
      name: 'baserow_update_api_token',
      description:
        'Rename a database API token, replace its permissions, or rotate its key. When passing permissions, include all four operations.',
      inputSchema: {
        type: 'object',
        properties: {
          token_id: {
            type: 'number',
            description: 'The ID of the token'
          },
          name: {
            type: 'string',
            description: 'New token name'
          },
          permissions: PERMISSIONS_SCHEMA,
          rotate_key: {
            type: 'boolean',
            description: 'Generate a new key (the old key stops working)'
          }
        },
        required: ['token_id']
      }
    },
    {
      name: 'baserow_delete_api_token',
      description: 'Delete a database API token. Anything using its key stops working immediately.',
      inputSchema: {
        type: 'object',
        properties: {
          token_id: {
            type: 'number',
            description: 'The ID of the token'
          }
        },
        required: ['token_id']
      }
    }
  ];
}

export async function handleTokenTools(
  client: BaserowClient,
  toolName: string,
  args: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: any;

  switch (toolName) {
    case 'baserow_list_api_tokens':
      result = await client.listApiTokens();
      break;

    case 'baserow_create_api_token':
      if (!args?.name || !args?.workspace_id) {
        throw new Error('name and workspace_id are required');
      }
      result = await client.createApiToken({
        name: args.name,
        workspace_id: args.workspace_id,
        permissions: args.permissions
      });
      break;

    case 'baserow_update_api_token':
      if (!args?.token_id) {
        throw new Error('token_id is required');
      }
      if (args.name === undefined && args.permissions === undefined && !args.rotate_key) {
        throw new Error('Provide at least one of name, permissions or rotate_key');
      }
      result = await client.updateApiToken({
        token_id: args.token_id,
        name: args.name,
        permissions: args.permissions,
        rotate_key: args.rotate_key
      });
      break;

    case 'baserow_delete_api_token':
      if (!args?.token_id) {
        throw new Error('token_id is required');
      }
      await client.deleteApiToken(args.token_id);
      result = {
        success: true,
        message: `Token ${args.token_id} deleted successfully`
      };
      break;

    default:
      throw new Error(`Unknown token tool: ${toolName}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}
