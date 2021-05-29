/// <reference path="./typings.d.ts" />

import * as RustyRoom from "./room";
import * as SpecializedCreeps from "./specializedCreeps";
import { Logger, loggerLevels, LogLevel } from "./utility/logger";
import { ConsoleUtils } from "./utility/console";

loggerLevels.push(
    ["Rusty", LogLevel.warning],
    ["Rusty.loop", LogLevel.info],
    ["Rusty.Utility.Console", LogLevel.trace],
    ["Rusty.SpecializedCreeps.CollectorCreep.#Slateleg", LogLevel.trace],
    ["Rusty.SpecializedCreeps.CollectorCreep.#DragonflyPetal", LogLevel.trace]
);

let volatilePersistedTicks = 0;
(global as unknown as Record<string, unknown>)["ConsoleUtils"] = ConsoleUtils;

export function loop() {
    const logger = new Logger("Rusty.loop");
    logger.info(`Started. Time: ${Game.time} tks; Bucket: ${Game.cpu.bucket}; VolatilePersisted: ${volatilePersistedTicks} tks.`);
    volatilePersistedTicks++;
    // const startTime = performance.now();
    try {
        RustyRoom.onNextFrame();
        SpecializedCreeps.onNextFrame();
    } catch (err) {
        logger.error(err);
    } finally {
        // const duration = Math.round(performance.now() - startTime);
        // console.log(`Rusty primary loop: Finished in ${duration}ms.`);
        logger.info(`CPU time: ${Math.round(Game.cpu.getUsed() * 1000) / 1000}.`);
    }
}
