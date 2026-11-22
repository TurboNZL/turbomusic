import { describe, expect, it } from 'vitest';
import { parseYtmListing } from '../src/lib/ytmListing.ts';

const text = `Starting From Zero (feat. Michael McDonald)
Justice
110K plays

 

3:10
2
That's It (feat. Future & Metro Boomin)
Yung Lean
5.4M plays

 

2:42
5
Sexy Magic
CA7RIEL & Paco Amoroso
, 
PinkPantheress
, 
Fred again..
 & 
Etienne De Crécy
7.6M plays

 

3:16
Overtown Lights
Stanley Clarke
, 
Yussef Dayes
 & 
Robert Glasper
19K plays

 

3:02
`;
describe('YouTube Music track list text', () => {
  const t = parseYtmListing(text);
  it('reads titles, lead artists and featured artists', () => {
    expect(t).toHaveLength(4);
    expect(t[0]).toMatchObject({ title: 'Starting From Zero', leads: ['Justice'], featured: ['Michael McDonald'], duration: '3:10' });
    expect(t[1]).toMatchObject({ title: "That's It", leads: ['Yung Lean'], featured: ['Future', 'Metro Boomin'] });
    expect(t[2].leads).toEqual(['CA7RIEL & Paco Amoroso', 'PinkPantheress', 'Fred again..', 'Etienne De Crécy']);
    expect(t[3]).toMatchObject({ title: 'Overtown Lights', leads: ['Stanley Clarke', 'Yussef Dayes', 'Robert Glasper'], plays: '19K plays' });
  });
});
