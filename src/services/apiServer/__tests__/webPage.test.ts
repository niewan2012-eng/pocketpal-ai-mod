/**
 * The served page is a single template literal with an inline script, so a
 * syntax error there is only visible in a browser — it took a user report to
 * find a stray `break` that stopped the whole script from running (the header
 * just sat on its placeholder). This parses the script and checks the pieces
 * the page is useless without.
 */

import {WEB_PAGE_HTML} from '../webPage';

const scriptOf = (html: string): string => {
  const match = /<script>([\s\S]*)<\/script>/.exec(html);
  if (!match) {
    throw new Error('no inline script found');
  }
  return match[1]!;
};

describe('apiServer web page', () => {
  it('parses as JavaScript', () => {
    const script = scriptOf(WEB_PAGE_HTML);
    // `new Function` throws SyntaxError on a script that would not run in the
    // browser; the body is never executed. The lint rule exists for production
    // code, where eval is a real hazard.
    // eslint-disable-next-line no-new-func
    expect(() => new Function(script)).not.toThrow();
  });

  it('has the controls the page needs', () => {
    for (const id of [
      'log',
      'input',
      'send',
      'stream',
      'think',
      'file',
      'attachBar',
      'model',
      'visionHint',
    ]) {
      expect(WEB_PAGE_HTML).toContain(`id="${id}"`);
    }
  });

  it('talks to the endpoints the server serves', () => {
    expect(WEB_PAGE_HTML).toContain("fetch('/v1/models'");
    expect(WEB_PAGE_HTML).toContain("fetch('/v1/chat/completions'");
  });

  it('sends images as content parts', () => {
    expect(WEB_PAGE_HTML).toContain("type: 'image_url'");
    expect(WEB_PAGE_HTML).toContain('enable_thinking: thinkBox.checked');
  });

  it('never leaves a failure invisible', () => {
    // Both guards exist because a stuck page is indistinguishable from a hung
    // request: one reports script errors, the other times out the model lookup.
    expect(WEB_PAGE_HTML).toContain("addEventListener('error'");
    expect(WEB_PAGE_HTML).toContain('AbortSignal.timeout');
  });
});
