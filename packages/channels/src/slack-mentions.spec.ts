import { describe, expect, it } from 'vitest';
import { detectSlackMentions } from './slack.js';

describe('detectSlackMentions', () => {
  it('detects the bot mention', () => {
    expect(detectSlackMentions('<@UBOT> deploy please', 'UBOT')).toEqual({ mentionedBot: true, mentionedOther: false });
  });

  it('detects other users, including labelled mentions', () => {
    expect(detectSlackMentions('ask <@U123|alice> instead', 'UBOT')).toEqual({ mentionedBot: false, mentionedOther: true });
  });

  it('reports both when bot and others are mentioned', () => {
    expect(detectSlackMentions('<@UBOT> loop in <@W9>', 'UBOT')).toEqual({ mentionedBot: true, mentionedOther: true });
  });

  it('reports nothing when the bot id is unknown', () => {
    expect(detectSlackMentions('<@UBOT> hi', undefined)).toEqual({ mentionedBot: false, mentionedOther: false });
  });
});
