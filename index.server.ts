import type { PluginServerContext } from "@getpaseo/plugin/server";
import { piggeryPath } from "./server/installed.ts";
import { MailReader, pickDatabase } from "./server/mail.ts";
import { piggeryHome, pickBin, realDir, runPiggery } from "./server/piggery.ts";
import { Person } from "./server/person.ts";
import { checkoutRemoteUrl, configureAgent, listTimelinePrompts, listUsageReports, resumeInPaseo, rewindAgent, searchTimeline, searchForge, stopAgent, suggestEntries, uploadFile } from "./server/paseo.ts";
import { ATTACH_ROOT, bodyWithAttachments, bodyWithImages, saveImages, uploadTooLarge } from "./server/attach.ts";
import { TranscriptReader } from "./server/transcript.ts";
import { PromptImageReader } from "./server/prompt-images.ts";
import { notifyHooksSet } from "./server/notify.ts";
import { adminCall } from "./server/admin.ts";
import { StateRecorder, STATES_FILE } from "./server/states.ts";
import { dictationReadiness, transcribe as transcribeRecording } from "./server/speech.ts";
import { pastedImageSaver, readImage } from "./server/image.ts";
import { agentConfig, usageReports, checkoutRemote, dictationStatus, dirSuggest, forgeSearch, imageFile, mail, models, notifyStatus, person, promptImages, resume, sendMail, sessions, settings, snapshot, stepIn, stop, tail, timelinePrompts, rewind, timelineSearch, transcribe, transcript, upload, viewSettings } from "./shared/rpc.ts";
import { TAIL_VERSION } from "./shared/view.ts";

const STEP_IN_TIMEOUT_MS = 30000;

export default function contribute(server: PluginServerContext) {
  const stored = server.registerSettings(settings);
  server.registerSettings(viewSettings);
  const bin = async () => {
    const state = await stored.read();
    return pickBin(state.status === "ready" ? state.values.path : "", piggeryPath);
  };

  const states = new StateRecorder(STATES_FILE, async () => runPiggery(await bin(), ["ps", "--view"]));
  states.start();
  server.handle(snapshot, async ({ dir }) => {
    const r = await states.snapshot();
    if (!r.ok) return r;
    return { ok: true as const, view: r.view, segments: states.segments(), dir: dir === undefined ? undefined : await realDir(dir) };
  });

  server.handle(tail, async ({ id, lines }) => {
    const r = await runPiggery(await bin(), ["tail", id, "-n", String(lines), "--view"]);
    if (!r.ok) return r;
    try {
      const doc = JSON.parse(r.out);
      if (doc.version < TAIL_VERSION) return { ok: false as const, code: "older" as const, error: `piggery speaks tail --view version ${doc.version}; this plugin reads ${TAIL_VERSION}. Update piggery.` };
      if (doc.version > TAIL_VERSION) return { ok: false as const, code: "newer" as const, error: `piggery speaks tail --view version ${doc.version}; this plugin reads ${TAIL_VERSION}. Run piggery setup paseo to update the plugin, then reload the Paseo app.` };
      if (Array.isArray(doc.lines)) return { ok: true as const, lines: doc.lines };
    } catch {}
    return { ok: false as const, code: "failed" as const, error: "piggery tail --view did not print JSON." };
  });

  const reader = new MailReader();
  server.handle(mail, async (filter) => {
    const state = await stored.read();
    return reader.read(pickDatabase(state.status === "ready" ? state.values.database : ""), filter);
  });

  const me = new Person((line) => console.log(line));
  const database = async () => {
    const state = await stored.read();
    return pickDatabase(state.status === "ready" ? state.values.database : "");
  };

  const transcripts = new TranscriptReader(reader, pastedImageSaver(`${ATTACH_ROOT}/pasted`));
  server.handle(transcript, async ({ id, before, limit, since }) => {
    const file = await database();
    return transcripts.read(file, id, before, limit, me.current(file)?.id, since);
  });

  server.handle(imageFile, async ({ path }) => readImage(path));

  const prompts = new PromptImageReader(pastedImageSaver(`${ATTACH_ROOT}/pasted`));
  server.handle(promptImages, async ({ id }) => prompts.read(reader, await database(), id));
  void database().then((db) => me.warm(db));
  server.handle(person, async () => {
    const who = me.current(await database());
    return { ok: true as const, person: who ? { id: who.id, name: who.name } : null };
  });
  server.handle(sendMail, async ({ images, attachments, ...input }) => {
    let files: string[];
    try {
      files = await saveImages(ATTACH_ROOT, input.to, images ?? []);
    } catch (error) {
      return { ok: false as const, code: "failed" as const, error: `Could not save the image: ${String((error as Error).message ?? error)}` };
    }
    const body = bodyWithAttachments(bodyWithImages(input.body, files), attachments ?? []);
    if (!body) return { ok: false as const, code: "failed" as const, error: "Nothing to send." };
    return me.send(await database(), { ...input, body });
  });
  server.handle(sessions, async ({ ids }) => {
    try {
      return { ok: true as const, sessions: reader.sessions(await database(), ids) };
    } catch (error) {
      return { ok: false as const, code: "failed" as const, error: `Could not read piggery's database: ${String((error as Error).message ?? error)}` };
    }
  });
  server.handle(upload, async ({ fileName, mimeType, data }) => {
    const tooLarge = uploadTooLarge(fileName, data);
    if (tooLarge) return { ok: false as const, code: "failed" as const, error: tooLarge };
    return uploadFile(fileName, mimeType, data);
  });
  server.handle(forgeSearch, async ({ cwd, query }) => searchForge(cwd, query));
  server.handle(dirSuggest, async ({ cwd, query }) => suggestEntries(cwd, query));
  server.handle(checkoutRemote, async ({ cwd }) => checkoutRemoteUrl(cwd));
  server.handle(dictationStatus, async () => dictationReadiness());
  server.handle(transcribe, async ({ format, chunks }) => transcribeRecording(format, chunks));
  server.handle(notifyStatus, async () => ({ ok: true as const, set: notifyHooksSet(piggeryHome()) }));
  server.handle(timelinePrompts, async ({ agentId }) => listTimelinePrompts(agentId));
  server.handle(rewind, async ({ agentId, messageId, mode }) => rewindAgent(agentId, messageId, mode));
  server.handle(timelineSearch, async ({ agentId, query, cursor }) => searchTimeline(agentId, query, cursor));
  server.handle(agentConfig, async ({ agentId, field, featureId, value }) => configureAgent(agentId, field, value, featureId));
  server.handle(usageReports, async (options) => listUsageReports(options));
  server.handle(stop, async ({ id, agentId }) => {
    if (agentId) return stopAgent(agentId);
    const r = await runPiggery(await bin(), ["abort", id]);
    return r.ok ? { ok: true as const } : r;
  });
  server.handle(stepIn, async (input) => {
    const args = input.verb === "model" ? ["model", input.id, ...(input.model ? [input.model] : []), ...(input.thinking ? ["--thinking", input.thinking] : [])] : [input.verb, input.id];
    if (input.verb === "model" && !input.model && !input.thinking) return { ok: false as const, code: "failed" as const, error: "Choose a model or a thinking level." };
    const r = await runPiggery(await bin(), args, STEP_IN_TIMEOUT_MS);
    return r.ok ? { ok: true as const, said: r.out.trim() } : r;
  });
  server.handle(models, async ({ id }) => {
    const r = await adminCall<{ models?: string[] }>(piggeryHome(), "models", { target: id });
    return r.ok ? { ok: true as const, models: r.value?.models ?? [] } : r;
  });
  server.handle(resume, async ({ id }) => {
    try {
      return await resumeInPaseo(reader.sessions(await database(), [id])[0]);
    } catch (error) {
      return { ok: false as const, code: "failed" as const, error: String((error as Error).message ?? error) };
    }
  });

  return () => {
    states.stop();
    me.stop();
    reader.close();
  };
}
