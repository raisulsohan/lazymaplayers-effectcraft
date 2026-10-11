// LazyMapLayers for EffectCraft: replaces LazyMapLayers' src/panel/basemap/nodeFileSource.ts in this
// version's build. The PMTiles archive on disk is read with HTTP range requests to the local server
// (app/server.mjs), asynchronously, instead of Node's synchronous file reads.

import type { RangeResponse, Source } from "pmtiles";

export class NodeFileSource implements Source {
  private readonly filePath: string;
  private readonly key: string;

  constructor(filePath: string, key: string) {
    this.filePath = filePath;
    this.key = key;
  }

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    const answer = await fetch(`/__file?p=${encodeURIComponent(this.filePath)}`, {
      headers: { "x-lmlec-token": window.__LMLEC__.token, range: `bytes=${offset}-${offset + length - 1}` },
      signal
    });
    if (answer.status !== 206 && answer.status !== 200) throw new Error(`could not read ${this.filePath}: ${answer.status} ${await answer.text()}`);
    return { data: await answer.arrayBuffer() };
  }

  close(): void {
    // Nothing is held open.
  }
}
