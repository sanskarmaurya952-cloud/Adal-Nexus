/**
 * FALLBACK SEED LIST. A small, human-curated list of AI company homepages used ONLY when web search fails or
 * yields too few usable sources. These were NOT discovered by search and are not evidence of anything by
 * themselves: every URL is still opened through the browser safety controls and facts are extracted from the
 * live page. Any source taken from this list is labelled origin "fallback" in all outputs.
 * Edit freely; the names are labels only (the record's name comes from the live page title).
 */
export const SEED_LIST_LABEL = "curated fallback seed list (src/server/research/seeds.ts), not discovered by search";

export interface Seed {
  name: string;
  url: string;
}

export const SEED_SOURCES: readonly Seed[] = [
  { name: "ElevenLabs", url: "https://elevenlabs.io/" },
  { name: "Replicate", url: "https://replicate.com/" },
  { name: "Perplexity", url: "https://www.perplexity.ai/" },
  { name: "Hugging Face", url: "https://huggingface.co/" },
  { name: "Jasper", url: "https://www.jasper.ai/" },
  { name: "Runway", url: "https://runwayml.com/" },
  { name: "Synthesia", url: "https://www.synthesia.io/" },
  { name: "Cohere", url: "https://cohere.com/" },
  { name: "Mistral AI", url: "https://mistral.ai/" },
  { name: "Pinecone", url: "https://www.pinecone.io/" },
  { name: "Writer", url: "https://writer.com/" },
  { name: "Together AI", url: "https://www.together.ai/" },
  { name: "AssemblyAI", url: "https://www.assemblyai.com/" },
  { name: "Descript", url: "https://www.descript.com/" },
  { name: "Cursor", url: "https://cursor.com/" },
  { name: "Lovable", url: "https://lovable.dev/" },
];
