import _ from "lodash";
import { CollectorCreep } from "src/specializedCreeps/collector";
import { structureNeedsRepair } from "src/specializedCreeps/collector/predicates";
import { CollectorCreepState } from "src/specializedCreeps/collector/state";
import * as CollectorTargetTracking from "src/specializedCreeps/collector/targetTracking";
import { DefenderCreep, DefenderCreepState } from "src/specializedCreeps/defender";
import { __internal__getSpecializedCreepsCache } from "src/specializedCreeps/registry";
import { initializeCreepMemory } from "src/specializedCreeps/spawn";
import { Logger, loggerLevels, LogLevel, purgeLoggerLevelCache } from "./logger";

const logger = new Logger("Rusty.Utility.Console");

export class ConsoleUtils {
    private constructor() {
    }

    public static dir(this: Record<string, unknown>) {
        console.log("Available members:\n" +
            _(Object.getOwnPropertyNames(ConsoleUtils))
                .difference(["prototype", "length", "name"])
                .map(k => `${k}: ${typeof (ConsoleUtils as unknown as Record<string, unknown>)[k]}`).join("\n"));
    }

    public static help = ConsoleUtils.dir;

    public static rebuildSpecializedCreepsMemory(mode?: "force"): void {
        const rebuiltNames: string[] = [];
        const missedNames: string[] = [];
        for (const v of _(Game.creeps).values()) {
            if (mode !== "force" && v.memory?.rustyType) continue;
            const body = _(v.body).groupBy(e => e.type).mapValues(e => e.length).value() as Partial<Record<BodyPartConstant, number>>;
            if (body.move && body.carry)
                initializeCreepMemory<CollectorCreepState>(v.name, CollectorCreep.rustyType, {
                    operation: { startTime: Game.time, opName: "idle", nextEvalTime: Game.time },
                    recentOperations: [],
                });
            else if (body.move && body.ranged_attack)
                initializeCreepMemory<DefenderCreepState>(v.name, DefenderCreep.rustyType, {});
            else {
                missedNames.push(v.name);
                continue;
            }
            rebuiltNames.push(v.name);
        }
        if (missedNames.length)
            logger.warning(`Did not rebuild memory on ${missedNames.length} Creeps: ${missedNames}.`);
        logger.info(`Rebuilt memory on ${rebuiltNames.length} Creeps: ${rebuiltNames}.`);
    }

    public static get specializedCreepsCache(): unknown {
        return __internal__getSpecializedCreepsCache();
    }

    public static get collectorTargetTracking(): unknown {
        return CollectorTargetTracking;
    }

    public static showStructureRepairStatus(room?: Room | string | Array<Room | string>): Record<string, number> {
        room = room || _(Game.spawns).values().map(s => s.room).uniq().value();
        if (!Array.isArray(room)) room = [room];
        if (!room.length) return {};
        const normalizedRooms = room.map(r => {
            if (typeof r === "string") {
                const rr = Game.rooms[r];
                if (!rr)
                    throw new Error(`Cannot find room ${r}.`);
                return rr;
            }
            return r;
        });
        const structures = _(normalizedRooms).map(r => [
            r.find(FIND_MY_STRUCTURES) as Structure[],
            r.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_WALL
                    || s.structureType === STRUCTURE_ROAD
            })
        ]).flatten().flatten();
        const structureStatus = structures
            .map(s => [s, structureNeedsRepair(s) || ""] as const)
            .groupBy(([s, r]) => r)
            .mapValues(entries => entries.map(([s, r]) => s))
            .value();
        for (const [status, structures] of _(structureStatus).entries()) {
            if (!status) continue;
            for (const s of structures)
                s.room.visual.text(status.substr(0, 2).toUpperCase(), s.pos, { opacity: 0.6 });
        }
        const result = _(structureStatus).mapValues(v => v.length).value();
        console.log(JSON.stringify(result));
        return result;
    }

    public static highlight(obj: RoomObject | string): RoomPosition | undefined {
        if (typeof obj === "string")
            obj = Game.getObjectById(obj) || Game.powerCreeps[obj] || Game.creeps[obj] || Game.spawns[obj];
        if (!obj || !(obj instanceof RoomObject) || !obj.room) return undefined;
        obj.room.visual.rect(obj.pos.x - 1, obj.pos.y - 1, 3, 3, { fill: "#ffcccc", opacity: 0.6 });
        obj.room.visual.rect(obj.pos.x, obj.pos.y, 1, 1, { fill: "#6666ff", opacity: 0.6 });
        return obj.pos;
    }

    public static get loggerLevels() {
        return loggerLevels;
    }

    private static trackCreepLogLevelSymbol = Symbol("trackCreepLogLevel");

    public static trackCreep(creepName?: string): void {
        if (!creepName) {
            const trackEntries = loggerLevels.filter(e => (e as any)[ConsoleUtils.trackCreepLogLevelSymbol]);
            for (const e of trackEntries) loggerLevels.remove(e);
            console.log(`Removed ${trackEntries.length} entries.`);
            purgeLoggerLevelCache();
            return;
        }
        const entry = [new RegExp(`^Rusty\\.SpecializedCreeps\\.\\w+\\.#${creepName}$`), LogLevel.trace] as const;
        (entry as any)[ConsoleUtils.trackCreepLogLevelSymbol] = true;
        loggerLevels.push(entry);
        purgeLoggerLevelCache();
    }
}
