import wu from "wu";
import { SpecializedCreepBase, SpecializedSpawnCreepErrorCode, stateFromCreep } from "./base";
import { initializeCreepMemory, spawnCreep } from "./spawn";

interface CollectorCreepState {
    sourceId?: Id<Source>;
}

let occupiedSourceCacheRoom: Room | undefined;
let occupiedSourceCache: Map<Id<Source>, Creep> | undefined;

function getOccupiedSources(room: Room): Map<Id<Source>, Creep> {
    if (room === occupiedSourceCacheRoom) return occupiedSourceCache || new Map();
    const result = new Map(wu(room
        .find(FIND_MY_CREEPS, { filter: c => c.memory.rustyType === CollectorCreep.rustyType }))
        .map(c => [stateFromCreep<CollectorCreepState>(c).sourceId, c])
        .filter((x): x is [Id<Source>, Creep] => !!x[0]));
    occupiedSourceCacheRoom = room;
    occupiedSourceCache = result;
    return result;
}

export class CollectorCreep extends SpecializedCreepBase<CollectorCreepState> {
    public static readonly rustyType = "collector";
    public static spawn(spawn: StructureSpawn): string | SpecializedSpawnCreepErrorCode {
        const name = spawnCreep(spawn, {
            [CARRY]: 5,
            [MOVE]: 5,
        });
        if (typeof name === "string") {
            initializeCreepMemory<CollectorCreepState>(spawn, CollectorCreep.rustyType, {});
        }
        return name;
    }
    public nextFrame(): void {
        const { creep, state } = this;
        let source = state.sourceId && Game.getObjectById(state.sourceId);
        if (!state.sourceId || !source) {
            const sources = this.creep.room.find(FIND_SOURCES_ACTIVE);
            const occupied = getOccupiedSources(this.creep.room);
            if (sources.length <= occupied.size) {
                // No new sources
                return;
            }
            state.sourceId = sources.find(s => !occupied.has(s.id))?.id;
            if (!state.sourceId) return;
            source = Game.getObjectById(state.sourceId)!;
        }
        if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
            creep.moveTo(source);
            return;
        }
    }
}
