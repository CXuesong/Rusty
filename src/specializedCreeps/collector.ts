import _ from "lodash/index";
import { SpecializedCreepBase, SpecializedSpawnCreepErrorCode, stateFromCreep } from "./base";
import { initializeCreepMemory, spawnCreep } from "./spawn";

interface CollectorCreepState {
    sourceId?: Id<Source>;
    spawnId?: Id<StructureSpawn>;
    dullTicks?: number;
    mode: "collect" | "distribute" | "distribute-spawn" | "distribute-controller";
}

let occupiedSpawnCacheRoom: Room | undefined;
let occupiedSpawnCache: Map<Id<StructureSpawn>, Set<Creep>> | undefined;

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
        });
        if (typeof name === "string") {
            initializeCreepMemory<CollectorCreepState>(name, CollectorCreep.rustyType, { mode: "collect" });
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
        state.mode = mode;
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
        state.dullTicks = (state.dullTicks || _.random(5, 15)) - 1;
        if (state.dullTicks <= 0) {
            state.dullTicks = undefined;
            return false;
        }
        return true;
    }
    private assignSource(sourceId?: Id<Source>): void {
        const { state } = this;
        state.sourceId = sourceId;
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
        state.spawnId = spawnId;
    }
    private findNextSource(): boolean {
        const { creep, state } = this;
        if (state.mode !== "collect") throw new Error("Invalid state.");
        let source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE, {
            costCallback: (roomName, cost) => {
                const room = Game.rooms[roomName];
                if (!room) {
                    console.log(`Collector: Unable to check room ${roomName}.`);
                    return;
                }
                const sources = room.find(FIND_SOURCES_ACTIVE);
                for (const s of sources) {
                    let c: number | undefined;
                    if (s.energy <= 2) c = 255;
                    else if (s.energy <= 20) c = 50;
                    else if (s.energy <= 50) c = 30;
                    else if (s.energy <= 100) c = 10;
                    else if (s.energy <= 1000) c = 5;
                    else c = undefined;
                    if (c != null) cost.set(s.pos.x, s.pos.y, c);
                }
            }
        });
        if (source) {
            this.assignSource(source.id);
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
            .filter(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
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
        const harvestResult = source && creep.harvest(source);
        if (!source || harvestResult === ERR_NOT_IN_RANGE) {
            if (source) creep.moveTo(source);
            if (this.tickDull()) return;
            // Recheck nearest source.
            if (!this.findNextSource()) {
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    this.switchMode("distribute");
                    return;
                }
                this.assignSource();
                return;
            }
            source = Game.getObjectById(state.sourceId!)!;
        } else if (harvestResult === ERR_NOT_ENOUGH_RESOURCES) {
            if (source.ticksToRegeneration > 10)
                this.findNextSource();
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
