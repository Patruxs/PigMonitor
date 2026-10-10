import type { PluginServerContext } from "@getpaseo/plugin/server";
import { piggeryPath } from "./server/installed.ts";
import { MailReader, pickDatabase } from "./server/mail.ts";
import { abort, listModels, piggeryHome, pickBin, runStepIn, snapshotView, tailView } from "./server/piggery.ts";
import { Person } from "./server/person.ts";
import { checkoutRemoteUrl, configureAgent, listTimelinePrompts, listUsageReports, resumeInPaseo, rewindAgent, searchTimeline, searchForge, stopAgent, suggestEntries, uploadFile } from "./server/paseo.ts";
import { ATTACH_ROOT, mailBody, uploadTooLarge } from "./server/attach.ts";
import { TranscriptReader } from "./server/transcript.ts";
import { PromptImageReader } from "./server/prompt-images.ts";
import { notifyHooksSet } from "./server/notify.ts";
import { dictationReadiness, transcribe as transcribeRecording } from "./server/speech.ts";
import { pastedImageSaver, readImage } from "./server/image.ts";
import { agentConfig, usageReports, checkoutRemote, dictationStatus, dirSuggest, forgeSearch, imageFile, mail, models, notifyStatus, person, promptImages, resume, sendMail, sessions, settings, snapshot, stepIn, stop, tail, timelinePrompts, rewind, timelineSearch, transcribe, transcript, upload, viewSettings } from "./shared/rpc.ts";

export default function contribute(server: PluginServerContext) {
  const stored = server.registerSettings(settings);
  server.registerSettings(viewSettings);
  const bin = async () => {
    const state = await stored.read();
    return pickBin(state.status === "ready" ? state.values.path : "", piggeryPath);
  };

  server.handle(snapshot, async ({ dir }) => snapshotView(await bin(), dir));
  server.handle(tail, async ({ id, lines }) => tailView(await bin(), id, lines));

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
    const composed = await mailBody(ATTACH_ROOT, input.to, input.body, images ?? [], attachments ?? []);
    return composed.ok ? me.send(await database(), { ...input, body: composed.body }) : composed;
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
  server.handle(stop, async ({ id, agentId }) => (agentId ? stopAgent(agentId) : abort(await bin(), id)));
  server.handle(stepIn, async (input) => runStepIn(await bin(), input));
  server.handle(models, async ({ id }) => listModels(piggeryHome(), id));
  server.handle(resume, async ({ id }) => {
    try {
      return await resumeInPaseo(reader.sessions(await database(), [id])[0]);
    } catch (error) {
      return { ok: false as const, code: "failed" as const, error: String((error as Error).message ?? error) };
    }
  });

  return () => {
    me.stop();
    reader.close();
  };
}
