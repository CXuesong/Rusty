import { SpecializedCreepBase, SpecializedSpawnCreepErrorCode, stateFromCreep } from "./base";
import { initializeCreepMemory, spawnCreep } from "./spawn";

interface CollectorCreepState {
    sourceId?: Id<Source>;
    spawnId?: Id<StructureSpawn>;
    dullTicks?: number;
    mode: "collect" | "distribute" | "distribute-spawn" | "distribute-controller";
}

let occupiedSourceCacheRoom: Room | undefined;
let occupiedSourceCache: Map<Id<Source>, Set<Creep>> | undefined;
let occupiedSpawnCacheRoom: Room | undefined;
let occupiedSpawnCache: Map<Id<StructureSpawn>, Set<Creep>> | undefined;

function getOccupiedSources(room: Room): Map<Id<Source>, Set<Creep>> {
    if (room === occupiedSourceCacheRoom) return occupiedSourceCache || new Map();
    const result = new Map(_(room
        .find(FIND_MY_CREEPS, { filter: c => c.memory.rustyType === CollectorCreep.rustyType }))
        .map(c => [stateFromCreep<CollectorCreepState>(c).sourceId, c] as const)
        .filter((x): x is [Id<Source>, Creep] => !!x[0])
        .groupBy(([s, _]) => s)
        .map((p, s) => [s as Id<Source>, new Set(_(p).map(([_, c]) => c))] as const));
    occupiedSourceCacheRoom = room;
    occupiedSourceCache = result;
    return result;
}

function getOccupiedSpawns(room: Room): Map<Id<StructureSpawn>, Set<Creep>> {
    if (room === occupiedSpawnCacheRoom) return occupiedSpawnCache || new Map();
    const result = new Map(_(room
        .find(FIND_MY_CREEPS, { filter: c => c.memory.rustyType === CollectorCreep.rustyType }))
        .map(c => [stateFromCreep<CollectorCreepState>(c).spawnId, c] as const)
        .filter((x): x is [Id<StructureSpawn>, Creep] => !!x[0])
        .groupBy(([s, _]) => s)
        .map((p, s) => [s as Id<StructureSpawn>, new Set(_(p).map(([_, c]) => c))] as const));
    occupiedSpawnCacheRoom = room;
    occupiedSpawnCache = result;
    return result;
}

export class CollectorCreep extends SpecializedCreepBase<CollectorCreepState> {
    public static readonly rustyType = "collector";
    public static spawn(spawn: StructureSpawn): string | SpecializedSpawnCreepErrorCode {
        const name = spawnCreep(spawn, {
            [CARRY]: 2,
            [MOVE]: 2,
            [WORK]: 1,
            [TOUGH]: 1,
        });
        if (typeof name === "string") {
            initializeCreepMemory<CollectorCreepState>(spawn, name, CollectorCreep.rustyType, { mode: "collect" });
        }
        return name;
    }
    public nextFrame(): void {
        const { state } = this;
        switch (state.mode) {
            case "collect":
                this.nextFrameCollect();
                break;
            case "distribute":
                this.nextFrameDistribute();
                break;
            case "distribute-spawn":
                this.nextFrameDistributeSpawn();
                break;
            case "distribute-controller":
                this.nextFrameDistributeController();
                break;
            default:
                this.switchMode("collect");
                break;
        }
    }
    private switchMode(mode: CollectorCreepState["mode"]): void {
        const { creep, state } = this;
        state.mode = "distribute";
        this.assignSource();
        this.assignSpawn();
        state.dullTicks = undefined;
        creep.say(`Switch mode: ${mode}.`);
    }
    // private idleThenSwitchMode(switchToMode: CollectorCreepState["mode"], idleTicks: number): void {
    //     const { state } = this;
    //     state.dullTicks = (state.dullTicks || 0) + 1;
    //     if (state.dullTicks >= idleTicks) {
    //         this.switchMode(switchToMode);
    //     }
    // }
    private tickDull(): boolean {
        const { state } = this;
        state.dullTicks = (state.dullTicks || _.random(5, 17)) - 1;
        if (state.dullTicks <= 0) {
            state.dullTicks = undefined;
            return false;
        }
        return true;
    }
    private assignSource(sourceId?: Id<Source>): void {
        const { creep, state } = this;
        if ((state.sourceId || undefined) === sourceId) return;
        if (occupiedSourceCache && creep.room === occupiedSourceCacheRoom) {
            if (state.sourceId) {
                // Release current
                occupiedSourceCache.get(state.sourceId)?.delete(creep);
            }
            if (sourceId) {
                // Register next
                const sl = occupiedSourceCache.get(sourceId);
                if (sl)
                    sl.add(creep);
                else
                    occupiedSourceCache.set(sourceId, new Set([creep]));
            }
        }
    }
    private assignSpawn(spawnId?: Id<StructureSpawn>): void {
        const { creep, state } = this;
        if ((state.spawnId || undefined) === spawnId) return;
        if (occupiedSpawnCache && creep.room === occupiedSpawnCacheRoom) {
            if (state.spawnId) {
                // Release current
                occupiedSpawnCache.get(state.spawnId)?.delete(creep);
            }
            if (spawnId) {
                // Register next
                const sl = occupiedSpawnCache.get(spawnId);
                if (sl)
                    sl.add(creep);
                else
                    occupiedSpawnCache.set(spawnId, new Set([creep]));
            }
        }
    }
    private findNextSource(): boolean {
        const { creep, state } = this;
        if (state.mode !== "collect") throw new Error("Invalid state.");
        const sources = creep.room.find(FIND_SOURCES_ACTIVE);
        const occupied = getOccupiedSources(this.creep.room);
        // TODO choose nearer sources with more energy.
        const nextSource = _(sources)
            .filter(s => (occupied.get(s.id)?.size || 0) <= 2)
            .maxBy(s => s.energy / (occupied.get(s.id)?.size || 0.1));
        if (nextSource) {
            this.assignSource(nextSource.id);
            return true;
        }
        return false;
    }
    private findNextSpawn(): boolean {
        const { creep, state } = this;
        if (state.mode !== "distribute"
            && state.mode !== "distribute-controller"
            && state.mode !== "distribute-spawn"
        ) throw new Error("Invalid state.");
        const spawns = creep.room.find(FIND_MY_SPAWNS);
        const occupied = getOccupiedSpawns(this.creep.room);
        // TODO choose nearer sources with more energy.
        const nextSpawn = _(spawns)
            .filter(s => (occupied.get(s.id)?.size || 0) <= 2)
            .maxBy(s => s.store.getFreeCapacity(RESOURCE_ENERGY) / (occupied.get(s.id)?.size || 0.1));
        if (nextSpawn) {
            this.switchMode("distribute-spawn");
            this.assignSpawn(nextSpawn.id);
            return true;
        }
        return false;
    }
    private checkEnergyConstraint(): boolean {
        const { creep, state } = this;
        switch (state.mode) {
            case "collect":
                if (!creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
                    this.switchMode("distribute");
                    return false;
                }
                return true;
            case "distribute":
            case "distribute-controller":
            case "distribute-spawn":
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                    this.switchMode("collect");
                    return false;
                }
                return true;
            default:
                throw new Error("Invalid state.");
        }
    }
    private nextFrameCollect(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        let source = state.sourceId && Game.getObjectById(state.sourceId);
        if (!state.sourceId || !source || !source.energy) {
            // Source exhausted
            if (this.tickDull()) return;
            if (!this.findNextSource()) {
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    this.switchMode("distribute");
                    return;
                }
                this.assignSource();
                return;
            }
            source = Game.getObjectById(state.sourceId!)!;
        }
        switch (creep.harvest(source)) {
            case ERR_NOT_IN_RANGE:
                creep.moveTo(source);
                return;
            case ERR_NOT_ENOUGH_RESOURCES:
                this.findNextSource();
                return;
        }
    }
    private nextFrameDistribute(): void {
        if (!this.checkEnergyConstraint()) return;
        // Check whether there are spawns to transfer energy.
        if (this.findNextSpawn()) return;
        // Otherwise, go upgrade controller.
        this.switchMode("distribute-controller");
    }
    private nextFrameDistributeSpawn(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        let spawn = state.spawnId && Game.getObjectById(state.spawnId);
        if (!state.spawnId || !spawn || !spawn.store.getFreeCapacity(RESOURCE_ENERGY)) {
            // Spawn is full
            if (this.tickDull()) return;
            if (!this.findNextSpawn()) {
                // We have more energy.
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= creep.store.getCapacity(RESOURCE_ENERGY) / 3) {
                    this.switchMode("distribute-controller");
                } else {
                    this.switchMode("collect");
                }
                return;
            }
            spawn = Game.getObjectById(state.spawnId!)!;
        }
        switch (creep.transfer(spawn, RESOURCE_ENERGY)) {
            case ERR_NOT_IN_RANGE:
                creep.moveTo(spawn);
                return;
            case ERR_FULL:
                this.findNextSpawn();
                return;
        }
    }
    private nextFrameDistributeController(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep } = this;
        let { controller } = creep.room;
        if (!controller || !controller.my) {
            if (this.tickDull()) return;
            // We have more energy.
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= creep.store.getCapacity(RESOURCE_ENERGY) / 4) {
                this.switchMode("distribute-spawn");
            } else {
                this.switchMode("collect");
            }
            return;
        }
        switch (creep.upgradeController(controller)) {
            case ERR_NOT_IN_RANGE:
                creep.moveTo(controller);
                return;
            case ERR_NOT_ENOUGH_RESOURCES:
                this.switchMode("distribute");
                return;
        }
    }
}
