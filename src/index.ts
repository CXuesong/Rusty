/// <reference path="./typings.d.ts" />
import "./utility/polyfill";
//
import * as RustyLoop from "./loop";
import * as RustyRoom from "./room";
import * as SpecializedCreeps from "./specializedCreeps";
import { ConsoleUtils } from "./utility/console";
import { Logger, loggerLevels, LogLevel } from "./utility/logger";

loggerLevels.push(
    ["Rusty", LogLevel.warning],
    ["Rusty.Index", LogLevel.info],
    ["Rusty.Loop", LogLevel.info],
    ["Rusty.Utility.Console", LogLevel.trace],
    ["Rusty.Utility.Combat", LogLevel.info],
    ["Rusty.SpecializedCreeps.Frame", LogLevel.info],
    // ["Rusty.SpecializedCreeps.CollectorCreep.#Plumthistle", LogLevel.trace],
);

let runtimeTicks = 0;
let runtimeCpuTimeTotal = 0;
(global as unknown as Record<string, unknown>)["RustyUtils"] = ConsoleUtils;

export function loop() {
    const logger = new Logger("Rusty.Index.loop");
    logger.info(`Started. Time: ${Game.time} tks; Bucket: ${Game.cpu.bucket}; Runtime: ${runtimeTicks} tks.`);
    runtimeTicks++;
    // const startTime = performance.now();
    try {
        RustyRoom.onNextFrame();
        SpecializedCreeps.onNextFrame();
        RustyLoop.onNextFrame();
    } catch (err) {
        logger.error(err);
    } finally {
        // const duration = Math.round(performance.now() - startTime);
        // console.log(`Rusty primary loop: Finished in ${duration}ms.`);
        const usedTime = Game.cpu.getUsed();
        runtimeCpuTimeTotal += usedTime;
        const ut = Math.round(usedTime * 1000) / 1000;
        const av = Math.round(runtimeCpuTimeTotal / runtimeTicks * 1000) / 1000;
        const tt = Math.round(runtimeCpuTimeTotal);
        logger.info(`CPU time: ${ut},${av},${tt}.`);
    }
}
