#!/usr/bin/env node
// MCP server (stdio) that lets a local coding agent (e.g. Codex) act as the spatial assistant for one editor session.
// It only relays to the editor server: SPATIAL_TAKE_URL (default http://127.0.0.1:8766) and SPATIAL_TAKE_SESSION (./spaces/<space>/scenarios/<take>/session.json).
// stdout carries the MCP protocol; never log to it.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';

const base=process.env.SPATIAL_TAKE_URL||'http://127.0.0.1:8766',session=process.env.SPATIAL_TAKE_SESSION||'./spaces/demo/scenarios/demo/session.json';
async function api(path,body){
  const url=new URL(path,base);if(!body)url.searchParams.set('session',session);
  const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...body})}:{});
  const data=await r.json().catch(()=>({error:r.statusText}));if(!r.ok)throw Error(data.error||r.statusText);return data;
}
const text=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,2)}]});
const failed=e=>({isError:true,content:[{type:'text',text:`Spatial Take editor unreachable or refused the request (${e.message}). Is \`npm start\` running?`}]});

const server=new McpServer({name:'spatial-take',version:'0.1.0'});
server.registerTool('get_user_context',{
  title:'Get user context',
  description:"The question being answered (if any), where the user is and what they look at at that moment (user.pose is the recorded camera), the time, and what the assistant knows about their home: objects with ids and state, routines, preferences, recent activity, calendar and a varied mock weather forecast. interaction.weather_mod determines whether weather effects are enabled. Household data is mock data for this prototype.",
  inputSchema:{groups:z.array(z.string()).optional().describe('Read only these context groups; [] returns the catalog and current date. Omit for legacy full context.')},
  annotations:{readOnlyHint:true}
},async({groups})=>{try{return text(await api(groups===undefined?'/api/agent/context':groups.length?'/api/agent/context?groups='+encodeURIComponent(groups.join(',')):'/api/agent/context?catalog=1'));}catch(e){return failed(e);}});
server.registerTool('show_response',{
  title:'Show response in the user\'s space',
  description:"Show your answer to the user as softly glowing text on a real surface in their view, at the moment of the question. Glanceable: a title of at most 6 words plus either a body of at most 25 words or up to 5 short items. Set question_id to the id of the question you answer, and anchor to the thing it is about; the anchor is kept for spatial placement later. When interaction.weather_mod is true AND the question concerns weather, first search weather.forecast in get_user_context, include time and weather in your answer, and pass the matching forecast_ids in weather. Select all requested periods, at most 384, and request weather.preview.component: weather-timeline for one day/afternoon, weather-day-buttons across dates, weather-single for one instant. The script builds controls and starts autoplay. Keep user-facing title/body concise; the existing user-view placement and adaptive style position the answer; weather effects avoid the text and preview-control region. Never invent forecast values. Non-weather questions omit weather.",
  inputSchema:{
    question_id:z.coerce.number().int().optional().describe('Id of the question being answered (from "Question #<id>")'),
    title:z.string().describe('The answer in at most 6 words'),
    body:z.string().optional().describe('At most 25 words'),
    items:z.array(z.string()).max(8).optional().describe('Short list entries, e.g. a grocery list'),
    question:z.string().optional().describe("The user's question, when not answering a numbered question"),
    weather:z.object({forecast_ids:z.array(z.string()).min(1).max(384),preview:z.object({component:z.enum(['weather-single','weather-timeline','weather-day-buttons']).describe('Request weather-timeline for variation within one day or afternoon; weather-day-buttons for multiple dates; weather-single for one instant.')}).optional()}).optional().describe('Exact weather.forecast or forecast.samples IDs from context; only for weather questions with Weather mod enabled. The renderer receives canonical time and weather from the server.'),
    findmy:z.discriminatedUnion('status',[
      z.object({status:z.literal('found'),item_id:z.string()}).strict(),
      z.object({status:z.enum(['not_found','ambiguous'])}).strict()
    ]).optional().describe('Only when interaction.findmy_mod is true: choose an available item_id from findmy_catalog, or not_found/ambiguous. Never generate geometry. Mutually exclusive with weather.'),
    anchor:z.object({object:z.string().describe('The thing the answer is about, e.g. fridge'),relation:z.enum(['on','above','in-front','beside']).optional()}).optional()
  }
},async args=>{try{const r=await api('/api/agent/responses',args);return text(`Shown to the user as response #${r.id} at ${r.t.toFixed(2)} s of the scenario.`);}catch(e){return failed(e);}});

await server.connect(new StdioServerTransport());
