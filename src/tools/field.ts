import { BaserowClient } from '../baserow-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

const FIELD_TYPE_HINT =
  'Common types and their options: text; long_text; number (number_decimal_places, number_negative); ' +
  'boolean; date (date_format: EU|US|ISO, date_include_time); single_select / multiple_select ' +
  '(select_options: [{value, color}], colors e.g. "green", "dark-green", "blue", "red", "orange", "yellow", "gray", "light-gray"); ' +
  'email; phone_number; url; rating (max_value); file; link_row (link_row_table_id); formula (formula); ' +
  'created_on; last_modified; autonumber; uuid.';

export function getFieldToolSchemas(): Tool[] {
  return [
    {
      name: 'baserow_list_fields',
      description: 'List all fields (columns) of a table with their types and options',
      inputSchema: {
        type: 'object',
        properties: {
          table_id: {
            type: 'number',
            description: 'The ID of the table'
          }
        },
        required: ['table_id']
      }
    },
    {
      name: 'baserow_create_field',
      description: `Create a new field (column) in a table. ${FIELD_TYPE_HINT}`,
      inputSchema: {
        type: 'object',
        properties: {
          table_id: {
            type: 'number',
            description: 'The ID of the table'
          },
          name: {
            type: 'string',
            description: 'Field name'
          },
          type: {
            type: 'string',
            description: 'Baserow field type (e.g. text, number, single_select, boolean, date)'
          },
          options: {
            type: 'object',
            description: 'Type-specific options merged into the request (e.g. {"select_options":[{"value":"S","color":"blue"}]} or {"number_decimal_places":0})',
            additionalProperties: true
          }
        },
        required: ['table_id', 'name', 'type']
      }
    },
    {
      name: 'baserow_update_field',
      description: `Update a field: rename it, change its type, or change type-specific options. ${FIELD_TYPE_HINT}`,
      inputSchema: {
        type: 'object',
        properties: {
          field_id: {
            type: 'number',
            description: 'The ID of the field'
          },
          name: {
            type: 'string',
            description: 'New field name'
          },
          type: {
            type: 'string',
            description: 'New field type (converting may lose data)'
          },
          options: {
            type: 'object',
            description: 'Type-specific options merged into the request',
            additionalProperties: true
          }
        },
        required: ['field_id']
      }
    },
    {
      name: 'baserow_delete_field',
      description: 'Delete a field (column) and all of its data. The primary field cannot be deleted.',
      inputSchema: {
        type: 'object',
        properties: {
          field_id: {
            type: 'number',
            description: 'The ID of the field'
          }
        },
        required: ['field_id']
      }
    }
  ];
}

export async function handleFieldTools(
  client: BaserowClient,
  toolName: string,
  args: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: any;

  switch (toolName) {
    case 'baserow_list_fields':
      if (!args?.table_id) {
        throw new Error('table_id is required');
      }
      result = await client.getTableFields(args.table_id);
      break;

    case 'baserow_create_field':
      if (!args?.table_id || !args?.name || !args?.type) {
        throw new Error('table_id, name and type are required');
      }
      result = await client.createField({
        table_id: args.table_id,
        name: args.name,
        type: args.type,
        options: args.options
      });
      break;

    case 'baserow_update_field':
      if (!args?.field_id) {
        throw new Error('field_id is required');
      }
      if (args.name === undefined && args.type === undefined && !args.options) {
        throw new Error('Provide at least one of name, type or options');
      }
      result = await client.updateField({
        field_id: args.field_id,
        name: args.name,
        type: args.type,
        options: args.options
      });
      break;

    case 'baserow_delete_field':
      if (!args?.field_id) {
        throw new Error('field_id is required');
      }
      await client.deleteField(args.field_id);
      result = {
        success: true,
        message: `Field ${args.field_id} deleted successfully`
      };
      break;

    default:
      throw new Error(`Unknown field tool: ${toolName}`);
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
