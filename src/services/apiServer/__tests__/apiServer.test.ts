/**
 * The API server is the app's only network-facing surface, and the transport
 * lives in native code that unit tests cannot reach. What is worth pinning down
 * here is the routing and the OpenAI shapes, driven through the same event the
 * Kotlin module emits.
 */

const mockRespond = jest.fn();
const mockBeginStream = jest.fn();
const mockWriteStreamChunk = jest.fn();
const mockEndStream = jest.fn();
const mockNativeStart = jest.fn();
const mockNativeStop = jest.fn();
const mockGetInfo = jest.fn();

jest.mock('../../../specs/NativeApiServer', () => ({
  __esModule: true,
  default: {
    start: (...args: unknown[]) => mockNativeStart(...args),
    stop: (...args: unknown[]) => mockNativeStop(...args),
    getInfo: (...args: unknown[]) => mockGetInfo(...args),
    respond: (...args: unknown[]) => mockRespond(...args),
    beginStream: (...args: unknown[]) => mockBeginStream(...args),
    writeStreamChunk: (...args: unknown[]) => mockWriteStreamChunk(...args),
    endStream: (...args: unknown[]) => mockEndStream(...args),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockCompletion = jest.fn();

jest.mock('../../../store', () => ({
  modelStore: {
    activeModel: undefined as {name: string} | undefined,
    context: undefined as unknown,
    engine: undefined as unknown,
    // The server pins the model while it serves; the store call is what does it.
    disableAutoRelease: jest.fn(),
    enableAutoRelease: jest.fn(),
  },
}));

const {modelStore} = jest.requireMock('../../../store');

const {DeviceEventEmitter} = require('react-native');
// The module under test is loaded once, on purpose: resetModules() would give it
// a different mocked DeviceEventEmitter instance than the one emitted on here.

const server = require('../index');

let nextId = 0;
const request = (method: string, path: string, body = '') =>
  DeviceEventEmitter.emit('ApiServerRequest', {
    id: ++nextId,
    method,
    path,
    body,
  });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('apiServer', () => {
  beforeEach(async () => {
    mockRespond.mockClear();
    mockBeginStream.mockClear();
    mockNativeStart.mockResolvedValue({
      running: true,
      port: 8080,
      urls: ['http://192.168.1.5:8080'],
    });
    mockGetInfo.mockResolvedValue({
      running: true,
      port: 8080,
      urls: ['http://192.168.1.5:8080'],
    });
    await server.start(8080);
  });

  afterEach(async () => {
    mockNativeStop.mockResolvedValue(undefined);
    await server.stop();
  });

  it('reports the LAN address it was started with', async () => {
    expect(server.isRunning()).toBe(true);
    expect(server.getState().urls).toEqual(['http://192.168.1.5:8080']);
  });

  it('serves the chat page at /', async () => {
    request('GET', '/');
    await flush();
    expect(mockRespond).toHaveBeenCalledWith(
      expect.any(Number),
      200,
      expect.stringContaining('text/html'),
      expect.stringContaining('<title>'),
    );
  });

  it('lists the active model in OpenAI shape', async () => {
    modelStore.activeModel = {name: 'Qwen3.5-4B'};
    request('GET', '/v1/models');
    await flush();
    const body = JSON.parse(mockRespond.mock.calls[0][3]);
    expect(body.object).toBe('list');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('Qwen3.5-4B');
    modelStore.activeModel = undefined;
  });

  it('answers 503 when no model is loaded', async () => {
    request(
      'POST',
      '/v1/chat/completions',
      JSON.stringify({messages: [{role: 'user', content: 'hi'}]}),
    );
    await flush();
    expect(mockRespond).toHaveBeenCalledWith(
      expect.any(Number),
      503,
      'application/json',
      expect.stringContaining('no model loaded'),
    );
  });

  it('answers 400 for a body without messages', async () => {
    modelStore.context = {getFormattedChat: jest.fn()};
    modelStore.engine = {completion: mockCompletion};
    request('POST', '/v1/chat/completions', JSON.stringify({}));
    await flush();
    expect(mockRespond).toHaveBeenCalledWith(
      expect.any(Number),
      400,
      'application/json',
      expect.stringContaining('messages is required'),
    );
    modelStore.context = undefined;
    modelStore.engine = undefined;
  });

  it('answers 404 for unknown routes', async () => {
    request('GET', '/v1/nope');
    await flush();
    expect(mockRespond).toHaveBeenCalledWith(
      expect.any(Number),
      404,
      'application/json',
      expect.stringContaining('unknown route'),
    );
  });

  it('streams SSE chunks for stream:true and terminates with [DONE]', async () => {
    modelStore.context = {
      getFormattedChat: jest.fn().mockResolvedValue('<prompt>'),
    };
    mockCompletion.mockImplementation(
      async (_params: unknown, cb?: (d: {content: string}) => void) => {
        cb?.({content: 'hel'});
        cb?.({content: 'lo'});
        return {content: 'hello', text: 'hello'};
      },
    );
    modelStore.engine = {completion: mockCompletion};
    mockBeginStream.mockReturnValue(true);

    request(
      'POST',
      '/v1/chat/completions',
      JSON.stringify({messages: [{role: 'user', content: 'hi'}], stream: true}),
    );
    await flush();

    expect(mockBeginStream).toHaveBeenCalledWith(
      expect.any(Number),
      200,
      expect.stringContaining('text/event-stream'),
    );
    const chunks = mockWriteStreamChunk.mock.calls.map(
      call => call[1] as string,
    );
    expect(chunks.some(c => c.includes('hel'))).toBe(true);
    expect(chunks.some(c => c.includes('"finish_reason":"stop"'))).toBe(true);
    expect(chunks.some(c => c.includes('[DONE]'))).toBe(true);
    expect(mockEndStream).toHaveBeenCalled();

    modelStore.context = undefined;
    modelStore.engine = undefined;
  });
});
