/**
 * LAN API server: makes the model loaded in the app reachable over HTTP.
 *
 * Transport lives in Kotlin (`ApiServerModule`): it owns the socket and hands
 * each parsed request over as an `ApiServerRequest` event, then writes whatever
 * this module answers with. Everything below is routing and OpenAI-shaped
 * translation, so a phone on the same Wi-Fi can talk to
 * `http://<phone-ip>:8080/v1/chat/completions` with any OpenAI client, and a
 * plain browser gets a small chat page at `/`.
 *
 * Endpoints:
 *   GET  /                      chat page (self-contained HTML)
 *   GET  /v1/models             the active model, OpenAI list shape
 *   POST /v1/chat/completions   stream (SSE) and non-stream
 *   GET  /health                liveness, for scripts
 *   OPTIONS *                   CORS preflight
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {DeviceEventEmitter} from 'react-native';

import NativeApiServer, {
  ApiServerInfo,
  ApiServerRequestEvent,
} from '../../specs/NativeApiServer';

import {modelStore} from '../../store';
import {WEB_PAGE_HTML} from './webPage';

export const API_SERVER_PORT = 8080;

/**
 * The preference outlives the process: starting a server to serve the LAN is a
 * deliberate setup step, not something to re-enter after every app restart.
 */
const ENABLED_PREF_KEY = 'apiServer.enabled';

/**
 * OpenAI-style message. `content` is either plain text or a list of parts, which
 * is how images reach the model: llama.rn's getFormattedChat() turns each
 * `image_url` part into a media marker plus an entry in `media_paths`.
 */
type ContentPart =
  | {type: 'text'; text: string}
  | {type: 'image_url'; image_url: {url: string}};

type ChatMessage = {role: string; content: string | ContentPart[]};

interface ChatRequestBody {
  model?: string;
  messages?: ChatMessage[];
  prompt?: string;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  [key: string]: unknown;
}

/** Wildcard CORS: this server is meant for the LAN, and the web page is same-origin. */
const CORS_HEADERS = '';

/** SSE frames are newline-terminated; keep the escaping out of every literal. */
const NL = String.fromCharCode(10);

let started = false;
let lastInfo: ApiServerInfo = {running: false, port: 0, urls: []};
let generating = false;
/** Identifies the request that owns `generating`, so a superseded one cannot clear it. */
let requestSeq = 0;

export function getState(): ApiServerInfo {
  return lastInfo;
}

export function isRunning(): boolean {
  return started;
}

/** Start (or re-report) the server and return its LAN addresses. */
export async function start(port = API_SERVER_PORT): Promise<ApiServerInfo> {
  if (!NativeApiServer) {
    throw new Error('API server is not available in this build');
  }
  const info = await NativeApiServer.start(port);
  attach();
  // Serving over the network and releasing the model when the app goes to the
  // background are mutually exclusive: a request arriving while released can
  // only answer 503. Same mechanism the camera and image picker use.
  modelStore.disableAutoRelease('api-server');
  AsyncStorage.setItem(ENABLED_PREF_KEY, 'true').catch(() => {});
  started = info.running;
  lastInfo = info;
  return info;
}

export async function stop(): Promise<void> {
  detach();
  await NativeApiServer?.stop();
  modelStore.enableAutoRelease('api-server');
  AsyncStorage.setItem(ENABLED_PREF_KEY, 'false').catch(() => {});
  started = false;
  lastInfo = {...lastInfo, running: false};
}

async function refresh(): Promise<ApiServerInfo> {
  const info = (await NativeApiServer?.getInfo()) ?? lastInfo;
  lastInfo = info;
  started = info.running;
  return info;
}

let subscription: {remove: () => void} | null = null;

function attach() {
  if (subscription) {
    return;
  }
  console.log('[apiServer] listening for requests');
  subscription = DeviceEventEmitter.addListener(
    'ApiServerRequest',
    (event: ApiServerRequestEvent) => {
      console.log(`[apiServer] ${event.method} ${event.path}`);
      handleRequest(event).catch(err => {
        console.warn('[apiServer] request failed:', err);
      });
    },
  );
}

function detach() {
  subscription?.remove();
  subscription = null;
}

async function handleRequest(event: ApiServerRequestEvent): Promise<void> {
  const {id, method, path} = event;
  const route = path.split('?')[0] ?? '/';

  try {
    if (method === 'OPTIONS') {
      NativeApiServer?.respond(id, 204, 'text/plain', CORS_HEADERS);
      return;
    }

    if (method === 'GET' && (route === '/' || route === '/index.html')) {
      NativeApiServer?.respond(
        id,
        200,
        'text/html; charset=utf-8',
        WEB_PAGE_HTML,
      );
      return;
    }

    if (
      method === 'POST' &&
      (route === '/admin/vision' || route === '/v1/admin/vision')
    ) {
      // The app gates the image picker AND initMultimodal on a per-model
      // preference. When it is off, the button goes grey with no explanation,
      // which is indistinguishable from "this app cannot do images". This lets
      // a client (or a script) put it right without hunting for the eye icon.
      const active = modelStore.activeModel;
      if (!active) {
        NativeApiServer?.respond(
          id,
          409,
          'application/json',
          errorBody('no model loaded'),
        );
        return;
      }
      let enabled = true;
      try {
        const parsed = JSON.parse(event.body || '{}') as {enabled?: boolean};
        enabled = parsed.enabled !== false;
      } catch {
        // Empty/!JSON body means "enable".
      }
      if (!active.supportsMultimodal) {
        NativeApiServer?.respond(
          id,
          409,
          'application/json',
          errorBody('this model has no multimodal support to enable'),
        );
        return;
      }
      // setModelVisionEnabled() already reloads the context when the preference
      // actually changes; reloading again here tore the fresh context down.
      await modelStore.setModelVisionEnabled(active.id, enabled);
      if (!modelStore.context && modelStore.activeModelId === active.id) {
        await modelStore.initContext(modelStore.activeModel ?? active);
      }
      const projection = modelStore.models.find(
        m => m.id === (modelStore.activeModel ?? active).defaultProjectionModel,
      );
      NativeApiServer?.respond(
        id,
        200,
        'application/json',
        JSON.stringify({
          enabled,
          visionActive: modelStore.isMultimodalActive === true,
          projectionDownloaded: projection?.isDownloaded ?? false,
        }),
      );
      return;
    }

    if (method === 'GET' && route === '/debug/state') {
      // Answers "why can't this model see my image": the app needs a downloaded
      // projector that is paired with the active model, not just a VLM file.
      const active = modelStore.activeModel;
      const projectionId = modelStore.activeProjectionModelId;
      const projection = modelStore.models.find(m => m.id === projectionId);
      NativeApiServer?.respond(
        id,
        200,
        'application/json',
        JSON.stringify({
          model: active
            ? {
                id: active.name,
                supportsMultimodal: active.supportsMultimodal === true,
                defaultProjectionModel: active.defaultProjectionModel ?? null,
              }
            : null,
          vision: {
            active: modelStore.isMultimodalActive === true,
            // What resolveMultimodalConfig() requires: a recorded projection
            // model, downloaded, and vision not switched off for this model.
            pairedProjectionModelId: active?.defaultProjectionModel ?? null,
            pairedProjectionInModelList: Boolean(
              active?.defaultProjectionModel &&
                modelStore.models.find(
                  m => m.id === active.defaultProjectionModel,
                ),
            ),
            pairedProjectionDownloaded: Boolean(
              active?.defaultProjectionModel &&
                modelStore.models.find(
                  m => m.id === active.defaultProjectionModel,
                )?.isDownloaded,
            ),
            visionEnabledPreference: active
              ? modelStore.getModelVisionPreference(active)
              : false,
            projectionModelId: projectionId ?? null,
            projectionDownloaded: projection?.isDownloaded ?? false,
          },
        }),
      );
      return;
    }

    if (method === 'GET' && route === '/health') {
      NativeApiServer?.respond(
        id,
        200,
        'application/json',
        JSON.stringify({
          status: 'ok',
          model: activeModelId() ?? null,
          vision: modelStore.isMultimodalActive === true,
        }),
      );
      return;
    }

    if (method === 'GET' && (route === '/v1/models' || route === '/models')) {
      NativeApiServer?.respond(
        id,
        200,
        'application/json',
        JSON.stringify(modelsPayload()),
      );
      return;
    }

    if (
      method === 'POST' &&
      (route === '/v1/chat/completions' ||
        route === '/v1/completions' ||
        route === '/chat/completions')
    ) {
      await handleCompletion(id, event.body, route);
      return;
    }

    NativeApiServer?.respond(
      id,
      404,
      'application/json',
      JSON.stringify({
        error: {message: `unknown route ${method} ${route}`},
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    NativeApiServer?.respond(
      id,
      500,
      'application/json',
      JSON.stringify({error: {message}}),
    );
  }
}

function activeModelId(): string | undefined {
  return modelStore.activeModel?.name;
}

function modelsPayload() {
  const id = activeModelId();
  const created = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: id
      ? [
          {
            id,
            object: 'model',
            created,
            owned_by: 'pocketpal-mod',
            // Not part of the OpenAI schema, but the one thing a client cannot
            // otherwise discover before sending an image.
            capabilities: {vision: modelStore.isMultimodalActive === true},
          },
        ]
      : [],
  };
}

function errorBody(message: string) {
  return JSON.stringify({error: {message, type: 'invalid_request_error'}});
}

/** Messages from the request, or a single user turn from `prompt`. */
/** Data URLs go to disk: llama.rn reads images from a path, not from base64. */
async function materializeDataUrls(
  messages: ChatMessage[],
): Promise<{messages: ChatMessage[]; temporaryFiles: string[]}> {
  const temporaryFiles: string[] = [];
  const out: ChatMessage[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      out.push(message);
      continue;
    }
    const parts: ContentPart[] = [];
    for (const part of message.content) {
      if (part.type !== 'image_url') {
        parts.push(part);
        continue;
      }
      const url = part.image_url?.url ?? '';
      const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.*)$/s.exec(url);
      if (!match) {
        // Already a path or an http URL: leave it to llama.rn.
        parts.push(part);
        continue;
      }
      const extension = match[1]!.split('/')[1]!.replace('jpeg', 'jpg');
      const path = `${RNFS.TemporaryDirectoryPath}/pocketpal-api-${Date.now()}-${temporaryFiles.length}.${extension}`;
      await RNFS.writeFile(path, match[2]!, 'base64');
      temporaryFiles.push(path);
      parts.push({type: 'image_url', image_url: {url: path}});
    }
    out.push({...message, content: parts});
  }

  return {messages: out, temporaryFiles};
}

/** True when any message carries an image part. */
function hasImages(messages: ChatMessage[]): boolean {
  return messages.some(
    message =>
      Array.isArray(message.content) &&
      message.content.some(part => part.type === 'image_url'),
  );
}

function toMessages(body: ChatRequestBody): ChatMessage[] {
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages.map(m => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? (m.content as ContentPart[])
        : m.content,
    }));
  }
  if (typeof body.prompt === 'string') {
    return [{role: 'user', content: body.prompt}];
  }
  return [];
}

function toStop(body: ChatRequestBody): string[] | undefined {
  if (!body.stop) {
    return undefined;
  }
  return Array.isArray(body.stop) ? body.stop : [body.stop];
}

async function handleCompletion(
  id: number,
  rawBody: string,
  route: string,
): Promise<void> {
  let body: ChatRequestBody;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    NativeApiServer?.respond(
      id,
      400,
      'application/json',
      errorBody('invalid JSON body'),
    );
    return;
  }

  const messages = toMessages(body);
  if (messages.length === 0) {
    NativeApiServer?.respond(
      id,
      400,
      'application/json',
      errorBody('messages is required'),
    );
    return;
  }

  const context = modelStore.context;
  const engine = modelStore.engine;
  if (!context || !engine) {
    NativeApiServer?.respond(
      id,
      503,
      'application/json',
      errorBody(
        modelStore.activeModel
          ? 'the model is loaded but its context was released — bring the app to the foreground and send one message, then retry'
          : 'no model loaded in the app',
      ),
    );
    return;
  }

  const myTurn = ++requestSeq;
  if (hasImages(messages) && !modelStore.isMultimodalActive) {
    NativeApiServer?.respond(
      id,
      400,
      'application/json',
      errorBody(
        'this model has no vision projector loaded — pick a vision model (and its mmproj) in the app, or send text only',
      ),
    );
    return;
  }

  if (generating) {
    // One llama context, one generation at a time. Rather than answering 429 —
    // which locks the server behind a generation nobody is reading any more
    // (a reloaded page, a closed tab) — let the newest request win.
    try {
      await engine.stopCompletion();
    } catch (err) {
      console.warn('[apiServer] stopCompletion failed:', err);
    }
  }

  generating = true;
  /** Set once the SSE headers are written; the catch block needs it. */
  let streamOpened = false;
  /** Uploaded images, removed once the answer is done with them. */
  const temporaryFilesForRequest: string[] = [];
  const created = Math.floor(Date.now() / 1000);
  const completionId = `chatcmpl-${created}-${id}`;
  const model = activeModelId() ?? body.model ?? 'pocketpal';

  try {
    // The model's own chat template, exactly like the in-app chat path.
    const enableThinking = body.enable_thinking === true;
    let formatted: Awaited<ReturnType<typeof context.getFormattedChat>>;
    const {messages: preparedMessages, temporaryFiles} =
      await materializeDataUrls(messages);
    temporaryFilesForRequest.push(...temporaryFiles);
    formatted = await context.getFormattedChat(preparedMessages, null, {
      jinja: true,
      enable_thinking: enableThinking,
      reasoning_format: enableThinking ? 'auto' : 'none',
    });
    const prompt = typeof formatted === 'string' ? formatted : formatted.prompt;

    const mediaPaths =
      typeof formatted === 'string' ? undefined : formatted.media_paths;
    const params = {
      prompt,
      ...(mediaPaths && mediaPaths.length > 0 ? {media_paths: mediaPaths} : {}),
      // Reasoning models spend their budget on thinking first; 512 was not
      // enough for one answer on Qwen3.5.
      n_predict: body.max_tokens ?? 1024,
      enable_thinking: enableThinking,
      temperature: body.temperature ?? 0.8,
      top_p: body.top_p ?? 0.95,
      stop:
        toStop(body) ??
        (typeof formatted === 'string'
          ? undefined
          : (formatted as {additional_stops?: string[]}).additional_stops),
    };

    const wantsStream = body.stream === true;
    const chunkOf = (delta: Record<string, unknown>, finish?: string) =>
      `data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{index: 0, delta, finish_reason: finish ?? null}],
      })}\n\n`;

    if (wantsStream) {
      const opened = NativeApiServer?.beginStream(
        id,
        200,
        'text/event-stream; charset=utf-8',
      );
      if (!opened) {
        return;
      }
      streamOpened = true;
      NativeApiServer?.writeStreamChunk(
        id,
        chunkOf({role: 'assistant', content: ''}),
      );
      // `data.content` is the ACCUMULATED content so far, not a delta — sending
      // it as one repeats everything on every token. Diff it, and fall back to
      // the raw token when the parser had nothing to say yet.
      let text = '';
      let sentContent = '';
      const result = await engine.completion(params, data => {
        let delta = '';
        if (typeof data.content === 'string' && data.content.length > 0) {
          delta = data.content.startsWith(sentContent)
            ? data.content.slice(sentContent.length)
            : data.content;
          sentContent = data.content;
        } else if (typeof data.token === 'string') {
          delta = data.token;
        }
        if (delta) {
          text += delta;
          NativeApiServer?.writeStreamChunk(id, chunkOf({content: delta}));
        }
      });
      if (!text && result.text) {
        NativeApiServer?.writeStreamChunk(id, chunkOf({content: result.text}));
      }
      NativeApiServer?.writeStreamChunk(
        id,
        chunkOf({}, result.stopped_limit ? 'length' : 'stop'),
      );
      NativeApiServer?.writeStreamChunk(id, 'data: [DONE]\n\n');
      NativeApiServer?.endStream(id);
      return;
    }

    const result = await engine.completion(params);
    if (requestSeq !== myTurn) {
      NativeApiServer?.respond(
        id,
        409,
        'application/json',
        errorBody('superseded by a newer request'),
      );
      return;
    }
    const content = result.content ?? result.text ?? '';
    // `stop` is what clients branch on: telling them a truncated answer finished
    // is how "the model stopped mid-sentence" reports are born.
    const finishReason = result.stopped_limit ? 'length' : 'stop';
    const reasoning = result.reasoning_content ?? undefined;
    const payload =
      route === '/v1/completions'
        ? {
            id: completionId,
            object: 'text_completion',
            created,
            model,
            choices: [{index: 0, text: content, finish_reason: finishReason}],
            usage: {
              prompt_tokens: result.tokens_evaluated ?? 0,
              completion_tokens: result.tokens_predicted ?? 0,
              total_tokens:
                (result.tokens_evaluated ?? 0) + (result.tokens_predicted ?? 0),
            },
          }
        : {
            id: completionId,
            object: 'chat.completion',
            created,
            model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content,
                  ...(reasoning ? {reasoning_content: reasoning} : {}),
                },
                finish_reason: finishReason,
              },
            ],
            usage: {
              prompt_tokens: result.tokens_evaluated ?? 0,
              completion_tokens: result.tokens_predicted ?? 0,
              total_tokens:
                (result.tokens_evaluated ?? 0) + (result.tokens_predicted ?? 0),
            },
          };
    NativeApiServer?.respond(
      id,
      200,
      'application/json',
      JSON.stringify(payload),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (requestSeq !== myTurn) {
      // The only reason a superseded request throws is our own stopCompletion.
      NativeApiServer?.respond(
        id,
        409,
        'application/json',
        errorBody('superseded by a newer request'),
      );
      return;
    }
    // Once the SSE headers are out the status line is already sent: report the
    // failure as a final event and close, instead of pretending it was a 500.
    if (streamOpened) {
      try {
        NativeApiServer?.writeStreamChunk(
          id,
          `data: ${JSON.stringify({error: {message}})}` + NL + NL,
        );
        NativeApiServer?.writeStreamChunk(id, 'data: [DONE]' + NL + NL);
      } finally {
        NativeApiServer?.endStream(id);
      }
    } else {
      NativeApiServer?.respond(id, 500, 'application/json', errorBody(message));
    }
  } finally {
    for (const file of temporaryFilesForRequest) {
      RNFS.unlink(file).catch(() => {});
    }
    // Only the newest request owns the flag; a superseded one unwinds later.
    if (requestSeq === myTurn) {
      generating = false;
    }
  }
}

/**
 * Start the server again if it was running before the app was killed. Called
 * once at launch; failures are not fatal (the screen shows the error).
 */
export async function restore(): Promise<void> {
  try {
    const enabled = await AsyncStorage.getItem(ENABLED_PREF_KEY);
    if (enabled === 'true' && !started) {
      await start(API_SERVER_PORT);
    }
  } catch (err) {
    console.warn('[apiServer] restore failed:', err);
  }
}

/** Best-effort: report the current state without changing it. */
export async function syncState(): Promise<ApiServerInfo> {
  try {
    return await refresh();
  } catch {
    return lastInfo;
  }
}
