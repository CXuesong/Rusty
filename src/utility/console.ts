import _ from "lodash";
import { CollectorCreep, CollectorCreepState, structureNeedsRepair } from "src/specializedCreeps/collector";
import { DefenderCreep, DefenderCreepState } from "src/specializedCreeps/defender";
import { __internal__getSpecializedCreepsCache } from "src/specializedCreeps/registry";
import { initializeCreepMemory } from "src/specializedCreeps/spawn";
import { Logger } from "./logger";

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

    public static rebuildSpecializedCreepsMemory(): void {
        const rebuiltNames: string[] = [];
        const missedNames: string[] = [];
        for (const v of _(Game.creeps).values()) {
            if (v.memory?.rustyType) continue;
            const body = _(v.body).groupBy(e => e.type).mapValues(e => e.length).value() as Partial<Record<BodyPartConstant, number>>;
            if (body.move && body.carry)
                initializeCreepMemory<CollectorCreepState>(v.name, CollectorCreep.rustyType, { mode: "idle", nextEvalTime: Game.time });
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

    public static showStructureRepairStatus(room?: Room | string): Record<string, number> {
        if (typeof room === "string") room = Game.rooms[room];
        const structures = room ? _([
            room.find(FIND_MY_STRUCTURES) as Structure[],
            room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_WALL })
        ]).flatten() : _(Game.structures).values();
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
}
