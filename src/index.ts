/// <reference path="./typings.d.ts" />
import "./utility/polyfill";
//
import * as RustyLoop from "./loop";
import { ConsoleUtils } from "./utility/console";
import { Logger, loggerLevels, LogLevel } from "./utility/logger";
import dayjs from "dayjs";
import dayjsDuration from "dayjs/plugin/duration";
import { getGameMode } from "./utility/game";

dayjs.extend(dayjsDuration);

loggerLevels.push(
    ["Rusty", LogLevel.warning],
    ["Rusty.Index", LogLevel.info],
    ["Rusty.Loop", LogLevel.info],
    ["Rusty.Utility.Console", LogLevel.trace],
    ["Rusty.Utility.Combat", LogLevel.info],
    ["Rusty.SpecializedCreeps.Frame", LogLevel.info],
    ["Rusty.Structures.Link", LogLevel.info],
    ["Rusty.Task", LogLevel.trace],
    // ["Rusty.SpecializedCreeps.CollectorCreep.#Plumthistle", LogLevel.trace],
);

const runtimeStartTime = Date.now();
let runtimeTicks = 0;
let runtimeCpuTimeTotal = 0;
global.RustyUtils = ConsoleUtils;
let loopStarted = false;

export function loop() {
    const logger = new Logger("Rusty.Index.loop");
    const mode = getGameMode();
    logger.info(`Started [${mode}]. Time: ${Game.time} tks; Bucket: ${Game.cpu.bucket}; Runtime: ${runtimeTicks} tks.`);
    runtimeTicks++;
    const perfStartTime = mode === "sim" ? performance.now() : 0;
    const startTime = Date.now();
    try {
        if (!loopStarted) {
            logger.info(`Call RustyLoop.onLoopStarted.`);
            RustyLoop.onLoopStarted();
            loopStarted = true;
        } else {
            RustyLoop.onNextFrame();
        }
    } catch (err) {
        logger.error(err);
    } finally {
        const duration = Math.round(Date.now() - startTime);
        const runtimeDuration = dayjs.duration(Date.now() - runtimeStartTime, "ms").format();
        const tickDuration = Math.round((Date.now() - runtimeStartTime) / runtimeTicks * 1000) / 1000;
        const usedTime = mode === "sim" ? performance.now() - perfStartTime : Game.cpu.getUsed();
        runtimeCpuTimeTotal += usedTime;
        const ut = Math.round(usedTime * 1000) / 1000;
        const av = Math.round(runtimeCpuTimeTotal / runtimeTicks * 1000) / 1000;
        const tt = Math.round(runtimeCpuTimeTotal);
        logger.info(`Duration: ${duration}ms; Uptime: ${runtimeDuration}; TickDuration: ${tickDuration}ms; CPU time: ${ut},${av},${tt}.`);
    }
}
