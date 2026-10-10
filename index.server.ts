import type { PluginRpcContract } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { input as ZodInput, output as ZodOutput, ZodType } from "zod";
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

export const OBSERVE_ONLY_REFUSAL = { ok: false as const, code: "denied" as const, error: "This Paseo daemon runs PigMonitor observe-only, so nothing is sent to piggery or Paseo." };

export default function contribute(server: PluginServerContext) {
  const observeOnly = process.env.PIGMONITOR_OBSERVE_ONLY === "1";
  const changes = <I extends ZodType, O extends ZodType>(contract: PluginRpcContract<I, O>, handler: (input: ZodOutput<I>) => Promise<ZodInput<O>>, ..._refusable: typeof OBSERVE_ONLY_REFUSAL extends ZodInput<O> ? [] : [never]) =>
    server.handle(contract, observeOnly ? async () => OBSERVE_ONLY_REFUSAL as ZodInput<O> : handler);
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

  const savePasted = pastedImageSaver(`${ATTACH_ROOT}/pasted`);
  const transcripts = new TranscriptReader(reader, savePasted);
  server.handle(transcript, async ({ id, before, limit, since }) => {
    return transcripts.read(await database(), id, before, limit, me.current(piggeryHome())?.id, since);
  });

  server.handle(imageFile, async ({ path }) => readImage(path));

  const prompts = new PromptImageReader(savePasted);
  server.handle(promptImages, async ({ id }) => prompts.read(reader, await database(), id));
  if (!observeOnly) me.warm(piggeryHome());
  server.handle(person, async () => {
    const who = me.current(piggeryHome());
    return { ok: true as const, person: who ? { id: who.id, name: who.name } : null };
  });
  changes(sendMail, async ({ images, attachments, ...input }) => {
    const composed = await mailBody(ATTACH_ROOT, input.to, input.body, images ?? [], attachments ?? []);
    return composed.ok ? me.send(piggeryHome(), { ...input, body: composed.body }) : composed;
  });
  server.handle(sessions, async ({ ids }) => {
    try {
      return { ok: true as const, sessions: reader.sessions(await database(), ids) };
    } catch (error) {
      return { ok: false as const, code: "failed" as const, error: `Could not read piggery's database: ${String((error as Error).message ?? error)}` };
    }
  });
  changes(upload, async ({ fileName, mimeType, data }) => {
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
  changes(rewind, async ({ agentId, messageId, mode }) => rewindAgent(agentId, messageId, mode));
  server.handle(timelineSearch, async ({ agentId, query, cursor }) => searchTimeline(agentId, query, cursor));
  changes(agentConfig, async ({ agentId, field, featureId, value }) => configureAgent(agentId, field, value, featureId));
  server.handle(usageReports, async (options) => listUsageReports(options));
  changes(stop, async ({ id, agentId }) => (agentId ? stopAgent(agentId) : abort(await bin(), id)));
  changes(stepIn, async (input) => runStepIn(await bin(), input));
  server.handle(models, async ({ id }) => listModels(piggeryHome(), id));
  changes(resume, async ({ id }) => {
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
