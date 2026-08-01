# Daily MLB Rundown Video

This standalone, read-only feature consumes the existing validated MLB JSON files and writes only to `website/data/video/`. It never rebuilds canonical website data and is not attached to the production refresh schedule.

## Commands

- `npm run video:mlb:dry` — selections, source traces, narration, scene plan, and report without rendering.
- `npm run video:mlb:voice-sample` — generate only a short ElevenLabs opening sample for voice approval.
- `npm run video:mlb:preview` — short 960×540 preview.
- `npm run video:mlb` — final 1920×1080 MP4.
- `node scripts/video/build_daily_mlb_video.mjs --validate-existing` — revalidate the dated final MP4 without rerendering it.
- Add `-- --audio=/absolute/or/repo-relative/narration.mp3` to use manually supplied narration.
- Add `-- --music=/path/to/authorized-track.mp3`; it is mixed at eight percent beneath narration.

Install Node dependencies with `npm install`. Remotion supplies its supported renderer and media inspector. A separate FFmpeg installation is only needed for future post-processing outside Remotion.

ElevenLabs is preferred when `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are set. Optional controls are `ELEVENLABS_MODEL_ID`, `ELEVENLABS_STABILITY`, `ELEVENLABS_SIMILARITY_BOOST`, `ELEVENLABS_STYLE`, and `ELEVENLABS_SPEED`. OpenAI remains available through `OPENAI_API_KEY`, with optional `OPENAI_TTS_MODEL` and `OPENAI_TTS_VOICE`. Without a key or manual audio, rendering remains silent with captions and reports a warning. Background music is intentionally absent unless an authorized track is added later.

Top Players preserve calibrated probability order. Due Players require at least three supported indicators and a 48-point qualification score. Sleepers must be outside the headline ranks and require at least three matchup/upside indicators totaling 50 points. No category is padded.

Generation fails on stale or unhealthy slate data, stale required sources, duplicate players, missing slate players, missing trace records, unsupported identity fields, or null/undefined/NaN output. MP4 validation uses Remotion's media inspector and rejects a duration mismatch over two seconds.

Outputs are dated and saved under `website/data/video/`. Dry-run and preview reports use mode suffixes so they cannot overwrite the final report. MP4s should remain uncommitted and be distributed as workflow artifacts or through approved private storage.
