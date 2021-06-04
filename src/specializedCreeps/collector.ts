import _ from "lodash/index";
import { bodyPartArrayToProfile, BodyPartProfile } from "src/utility/creep";
import { Logger } from "src/utility/logger";
import { buildRoomCostMatrix, findNearestPath } from "src/utility/pathFinder";
import { enumSpecializedCreeps, SpecializedCreepBase, SpecializedSpawnCreepErrorCode } from "./base";
import { getSpecializedCreep } from "./registry";
import { initializeCreepMemory, spawnCreep } from "./spawn";

export const MIN_COLLECTABLE_ENERGY = 20;
const MIN_COLLECTABLE_ENERGY_NEAR = 5;
// const MAX_SOURCE_REGENERATION_WAIT = 20;
const RANGE_DISTANCE_RATIO = 1.6;
const AGGRESSIVE_UPGRADE_MODE = true;

export type CollectorCreepVariant = "normal" | "tall" | "grande" | "venti";

interface CollectorCreepStateBase {
    mode: string;
    isWalking?: boolean;
}

interface CollectorCreepStateIdle extends CollectorCreepStateBase {
    mode: "idle";
    nextEvalTime: number;
}

export type CollectorCreepCollectPrimaryDestType = Source | Tombstone | Resource;
export type CollectorCreepCollectSecondaryType = Creep | StructureStorage;
export type CollectorCreepCollectDestType = CollectorCreepCollectPrimaryDestType | CollectorCreepCollectSecondaryType;

// General structure: has hit point, may store energy.
type CollectorCreepDistributeStructureType =
    | StructureSpawn
    | StructureExtension
    | StructureTower
    | StructureRampart
    | StructureRoad
    | StructureWall
    | StructureContainer
    | StructureStorage;
export type CollectorCreepDistributeDestType =
    | ConstructionSite
    | StructureController
    | CollectorCreepDistributeStructureType;

interface CollectorCreepStateCollect extends CollectorCreepStateBase {
    mode: "collect";
    destId: Id<CollectorCreepCollectDestType>;
    /** Expiry at which the target and path cache can be considered as "invalidated". */
    nextEvalTime: number;
}

interface CollectorCreepStateCollectSource extends CollectorCreepStateCollect {
    readonly sourceId: Id<Source>;
    sourceDistance: 0;
}

// Resource dropped.
interface CollectorCreepStateCollectResource extends CollectorCreepStateCollect {
    readonly resourceId: Id<Resource>;
}

interface CollectorCreepStateCollectCreepRelay extends CollectorCreepStateCollect {
    readonly sourceCreepId: Id<Creep>;
    sourceDistance: number;
}

interface CollectorCreepStateCollectStorage extends CollectorCreepStateCollect {
    readonly storageId: Id<StructureStorage | Tombstone | Ruin>;
    sourceDistance: 0;
}

interface CollectorCreepStateDistribute extends CollectorCreepStateBase {
    mode: "distribute";
    destId: Id<CollectorCreepDistributeDestType>;
    /** Expiry at which the target and path cache can be considered as "invalidated". */
    nextEvalTime: number;
}

interface CollectorCreepStateDistributeStructure extends CollectorCreepStateDistribute {
    structureId: Id<CollectorCreepDistributeStructureType>;
    destId: Id<CollectorCreepDistributeStructureType>;
}

interface CollectorCreepStateDistributeController extends CollectorCreepStateDistribute {
    controllerId: Id<StructureController>;
    destId: Id<StructureController>;
}

interface CollectorCreepStateDistributeConstruction extends CollectorCreepStateDistribute {
    constructionSiteId: Id<ConstructionSite>;
    destId: Id<ConstructionSite>;
}

export type CollectorCreepState
    = CollectorCreepStateIdle
    | CollectorCreepStateCollectSource
    | CollectorCreepStateCollectResource
    | CollectorCreepStateCollectCreepRelay
    | CollectorCreepStateCollectStorage
    | CollectorCreepStateDistributeStructure
    | CollectorCreepStateDistributeController
    | CollectorCreepStateDistributeConstruction;

type CollectorDestId = Id<RoomObject>;

let occupiedDests: Map<CollectorDestId, Set<Id<Creep>>> | undefined;

const emptySet: ReadonlySet<any> = {
    entries: function* () { },
    forEach: () => { },
    has: () => false,
    keys: function* () { },
    size: 0,
    values: function* () { },
    [Symbol.iterator]: function* () { },
}

export function houseKeeping(logger: Logger) {
    if (occupiedDests) {
        let count = 0;
        for (const [destId, collectors] of occupiedDests) {
            if (!Game.getObjectById(destId)) {
                occupiedDests.delete(destId);
                continue;
            }
            for (const collector of collectors) {
                if (!(Game.getObjectById(collector) instanceof Creep)) {
                    collectors.delete(collector);
                }
            }
        }
        logger.info(`Removed ${count} dangling collector in occupiedDests cache.`);
    }
}

export function getTargetingCollectors(id: CollectorDestId): ReadonlySet<Id<Creep>> {
    if (!occupiedDests) {
        occupiedDests = new Map();
        for (const c of enumSpecializedCreeps(CollectorCreep)) {
            if (c.state.mode === "collect")
                addTargetingCollector(c.state.destId, c.id);
            else if (c.state.mode === "distribute")
                addTargetingCollector(c.state.destId, c.id);
        }
    }
    return occupiedDests.get(id) || emptySet;
}

function addTargetingCollector(id: CollectorDestId, collector: Id<Creep>): void {
    if (!occupiedDests) return;
    let set = occupiedDests.get(id);
    if (!set) {
        set = new Set();
        occupiedDests.set(id, set);
    }
    set.add(collector);
}

function removeTargetingCollector(id: CollectorDestId, collector: Id<Creep>): void {
    if (!occupiedDests) return;
    const set = occupiedDests.get(id);
    if (!set) return;
    set.delete(collector);
    if (!set.size) occupiedDests.delete(id);
}

export function structureNeedsRepair(structure: Structure): "now" | "yes" | "later" | false {
    // some WALL does not have hitsMax
    if (!structure.hitsMax || structure.hits >= structure.hitsMax) return false;
    if (structure instanceof StructureRampart) {
        if (AGGRESSIVE_UPGRADE_MODE) {
            if (structure.hits < 5000 + 3600 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME) return "now";
            if (structure.hits < 5000 + 3600 * 2 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME) return "yes";
            if (structure.hits < 5000 + 3600 * 12 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME) return "later";
            return false;
        }
        // 3600 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME = 15,800
        if (structure.hits < 5000 + 3600 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME) return "now";
        if (structure.hits < 10000 + 3600 * 24 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME) return "yes";
        // Rampart has relatively high hitsMax
        if (structure.hits < 50000 + 3600 * 24 * 2 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME) return "later";
        return false;
    }
    if (structure instanceof StructureWall) {
        if (AGGRESSIVE_UPGRADE_MODE) {
            if (structure.hits < 30000) return "now";
            if (structure.hits < 50000) return "yes";
            if (structure.hits < 100000) return "later";
            return false;
        }
        if (structure.hits < 50000) return "now";
        if (structure.hits < 500000) return "yes";
        if (structure.hits < 1000000) return "later";
        return false;
    }
    if (structure instanceof StructureRoad) {
        if (structure.hits < 2000 || structure.hits / structure.hitsMax < 0.2)
            return "now";
        if (structure.hits / structure.hitsMax < 0.8)
            return "yes";
        return "later";
    }
    // Tactic targets
    if (structure instanceof StructureTower || structure instanceof StructureSpawn) {
        const damage = structure.hitsMax - structure.hits;
        if (damage > 500)
            return "now";
        if (damage > 100)
            return "yes";
        return "later";
    }
    if (structure.hitsMax - structure.hits < 1000 && structure.hits / structure.hitsMax > 0.5) return false;
    // 2000 -- needs 20 ticks to repair.
    return structure.hits < 2000 || structure.hits / structure.hitsMax < 0.1
        ? "now" : "yes";
}

export function estimateResourceDecayRatio(target: CollectorCreepCollectDestType, currentPos: RoomPosition): number {
    const eta = target.pos.getRangeTo(currentPos) * RANGE_DISTANCE_RATIO;
    if (target instanceof Resource) {
        return Math.pow(1 - 1 / ENERGY_DECAY, eta);
    }
    if (target instanceof Tombstone) {
        const decayTime = eta - target.ticksToDecay;
        return decayTime > 0 ? Math.pow(1 - 1 / ENERGY_DECAY, eta) : 1;
    }
    return 1;
}

export function isCollectableFrom(target: CollectorCreepCollectPrimaryDestType, srcPos?: RoomPosition): boolean {
    const decayRatio = srcPos ? estimateResourceDecayRatio(target, srcPos) : 1;
    let storeInfo: { energy: number; rest: number; maxCollectors: number; };
    if ("store" in target) {
        storeInfo = {
            energy: target.store.energy * decayRatio,
            rest: (_(target.store).values().sum() || 0) * decayRatio,
            maxCollectors: /* target instanceof Creep ? 1 : */ 6,
        };
    } else if (target instanceof Resource) {
        if (target.resourceType === RESOURCE_ENERGY)
            storeInfo = { energy: target.amount * decayRatio, rest: 0, maxCollectors: 5 };
        else
            storeInfo = { energy: 0, rest: target.amount * decayRatio, maxCollectors: 5 };
    } else if (target instanceof Source) {
        if (srcPos && target.ticksToRegeneration < srcPos.getRangeTo(target) * RANGE_DISTANCE_RATIO)
            storeInfo = { energy: target.energyCapacity, rest: 0, maxCollectors: 8 };
        else
            storeInfo = { energy: target.energy, rest: 0, maxCollectors: 8 };
    } else {
        throw new TypeError("Unexpected target type.");
    }
    // else if (dest instanceof Mineral) store = dest
    const { energy: energyAmount, rest: restAmount } = storeInfo;
    const minCollectableEnergy = !srcPos || srcPos.inRangeTo(target, 2) ? MIN_COLLECTABLE_ENERGY_NEAR : MIN_COLLECTABLE_ENERGY_NEAR;
    const minCollectableOtherResource = 1;
    if (energyAmount < minCollectableEnergy && restAmount < minCollectableOtherResource) return false;
    const targetingCollectors = getTargetingCollectors(target.id);
    // Traffic control.
    if (targetingCollectors.size >= 6) return false;
    const collectorCap = _([...targetingCollectors]).map(id => Game.getObjectById(id)?.store.getFreeCapacity() || 0).sum();
    return collectorCap < energyAmount + restAmount;
}

export const __internal__debugInfo = {
    getOccupiedDests: () => occupiedDests
};

const variantDefinitions: Record<CollectorCreepVariant, { body: BodyPartProfile, prefix: string }> = {
    normal: {
        prefix: "CN:",
        // 300
        body: {
            [CARRY]: 2,     // 50
            [MOVE]: 2,      // 50
            [WORK]: 1,      // 100
        }
    },
    tall: {
        // 500
        prefix: "CT:",
        body: {
            [CARRY]: 2,
            [MOVE]: 4,
            [WORK]: 2,
        }
    },
    grande: {
        // 800
        prefix: "CG:",
        body: {
            [CARRY]: 2,
            [MOVE]: 6,
            [WORK]: 4,
        }
    },
    venti: {
        // 1200
        prefix: "CV:",
        body: {
            [CARRY]: 4,
            [MOVE]: 8,
            [WORK]: 6,
        }
    }
};

export class CollectorCreep extends SpecializedCreepBase<CollectorCreepState> {
    public static readonly rustyType = "collector";
    private logger = new Logger(`Rusty.SpecializedCreeps.CollectorCreep.#${this.creep.name}`);
    private pathCache: { targetId: string; targetPath: RoomPosition[] | PathStep[] } | undefined;
    public static spawn(spawn: StructureSpawn, variant?: CollectorCreepVariant): string | SpecializedSpawnCreepErrorCode {
        if (!variant) variant = "normal";
        var def = variantDefinitions[variant];
        const name = spawnCreep(spawn, def.body, { namePrefix: def.prefix });
        if (typeof name === "string") {
            initializeCreepMemory<CollectorCreepState>(name, CollectorCreep.rustyType, { mode: "idle", nextEvalTime: Game.time });
        }
        return name;
    }
    protected onNextFrame(): void {
        const { state } = this;
        switch (state.mode) {
            case "idle":
                this.nextFrameIdle();
                break;
            case "collect":
                this.nextFrameCollect();
                break;
            case "distribute":
                this.nextFrameDistribute();
                break;
            default:
                this.transitIdle();
                break;
        }
        this.renderTargetVisual();
    }
    protected onStateRootChanging(newState: CollectorCreepState): CollectorCreepState {
        const { creep, state } = this;
        if (newState.mode !== state.mode) {
            creep.say(newState.mode.split("-").map(s => s.substr(0, 4)).join("-"));
            this.logger.info(`Switch mode: ${state.mode} -> ${newState.mode}.`);
        }
        if ((state.mode === "collect" || state.mode === "distribute")
            && (newState.mode !== state.mode || !("destId" in newState) || newState.destId !== state.destId)) {
            removeTargetingCollector(state.destId, this.id);
            if (newState.mode === "collect" || newState.mode === "distribute")
                addTargetingCollector(newState.destId, this.id);
        }
        return newState;
    }
    public dispose() {
        const { state } = this;
        if (this.disposed) return;
        if ((state.mode === "collect" || state.mode === "distribute") && "destId" in state) {
            removeTargetingCollector(state.destId, this.id);
        }
        super.dispose();
    }
    private _variant: CollectorCreepVariant | undefined;
    public get variant() {
        if (!this._variant) {
            const { creep } = this;
            const body = bodyPartArrayToProfile(creep.body);
            if (body.move === 4) this._variant = "tall";
            else if (body.move === 6) this._variant = "grande";
            else if (body.move === 8) this._variant = "venti";
            else this._variant = "normal";
        }
        return this._variant;
    }
    private renderTargetVisual() {
        const { creep, state } = this;
        const { room } = creep;
        if ("destId" in state) {
            const target = Game.getObjectById(state.destId as Id<RoomObject>);
            if (target) {
                room.visual.line(creep.pos, target.pos, {
                    color: state.mode === "collect" ? "#ff0000" : "#00ff00",
                    lineStyle: "dashed",
                    opacity: 0.6,
                });
            } else {
                room.visual.text("Target Lost", creep.pos);
            }
        }
    }
    private transitCollect(): boolean {
        const { creep } = this;
        const { room } = creep;
        const reachedMaxPeers = (id: CollectorDestId, maxPeers: number) => {
            const c = getTargetingCollectors(id);
            const peers = c.size - (c.has(this.id) ? 1 : 0);
            return peers >= maxPeers;
        }
        const roomCallback = (roomName: string) => {
            const room = Game.rooms[roomName];
            if (!room) {
                this.logger.warning(`Unable to check room ${roomName}.`);
                return false;
            }
            const costs = buildRoomCostMatrix(room);
            costs.set(creep.pos.x, creep.pos.y, 0);
            return costs;
        }
        const targets = [
            ...room.find(FIND_TOMBSTONES),
            ...room.find(FIND_DROPPED_RESOURCES),
            ...room.find(FIND_SOURCES),
        ].filter(t => isCollectableFrom(t, creep.pos));
        // Prefer collect from direct source.
        let nearest = findNearestPath<Source | Tombstone | Resource | Creep | StructureStorage>(creep.pos, targets, {
            maxRooms: 1,
            roomCallback,
            plainCost: 2,
            swampCost: 6,
        });
        this.logger.info(`transitCollect: Nearest target: ${nearest?.goal}, cost ${nearest?.cost}.`);
        if (!nearest || nearest.cost > 10) {
            // If every direct source is too far away...
            // We allow stealing energy from existing collecting creeps,
            // only if they have already collected some energy.
            const collectingCreeps = enumSpecializedCreeps(CollectorCreep, room)
                .filter(c => c !== this
                    && c.state.mode === "collect"
                    && (("sourceId" in c.state || "sourceCreepId" in c.state) && c.state.sourceDistance <= 1)
                    && !reachedMaxPeers(c.id, 1))
                .map(c => c.creep)
                .filter(c => {
                    // We still need some time to arrive the target creep. Target can collect some more energy meanwhile.
                    const energyCap = c.store.getCapacity(RESOURCE_ENERGY);
                    const energyEst = Math.max(energyCap, c.store.energy + creep.pos.getRangeTo(c) * RANGE_DISTANCE_RATIO * c.getActiveBodyparts(WORK));
                    return energyEst / energyCap >= 0.6 || energyEst / creep.store.getCapacity(RESOURCE_ENERGY) >= 0.8
                })
                .value();
            // Also take a look at the storage at this point, before wandering away.
            // TODO schedule a proper storage-taking behavior.
            const storage = room.storage && room.storage.store.energy > creep.store.getCapacity(RESOURCE_ENERGY) * 0.8
                ? [/* room.storage */] : [];
            const secondary = collectingCreeps.length
                ? findNearestPath(creep.pos, [
                    ...storage,
                    ...collectingCreeps
                ], {
                    maxRooms: 1,
                    roomCallback,
                    plainCost: 2,
                    swampCost: 6,
                })
                : undefined;
            this.logger.info(`transitCollect: Secondary target: ${secondary?.goal}, cost ${secondary?.cost}.`);
            if (!nearest || secondary && nearest.cost - secondary.cost > 10)
                nearest = secondary;
        }
        if (!nearest) return false;
        const destId = nearest.goal.id;
        const nextEvalTime = Game.time + _.random(4, 10);
        const distance = nearest.goal.pos.getRangeTo(creep);
        this.logger.info(`transitCollect: Collect ${nearest.goal}, path: [${nearest.path.length}], cost ${nearest?.cost}, distnace: ${distance}.`);
        if (!nearest.path.length && distance > 1) {
            this.logger.warning(`transitCollect: Empty path to ${nearest.goal}. Distance: ${distance}.`);
        }
        if (nearest.goal instanceof Resource)
            this.state = { mode: "collect", resourceId: nearest.goal.id, destId, nextEvalTime };
        else if (nearest.goal instanceof Tombstone || nearest.goal instanceof StructureStorage || nearest.goal instanceof Ruin)
            this.state = { mode: "collect", storageId: nearest.goal.id, destId, sourceDistance: 0, nextEvalTime };
        else if (nearest.goal instanceof Source)
            this.state = { mode: "collect", sourceId: nearest.goal.id, destId, sourceDistance: 0, nextEvalTime };
        else if (nearest.goal instanceof Creep) {
            const sourceCollector = getSpecializedCreep(nearest.goal, CollectorCreep);
            if (!sourceCollector) throw new Error("Unexpected null sourceCollector.");
            const sourceState = sourceCollector.state;
            if (sourceState.mode === "collect" && ("sourceId" in sourceState || "sourceCreepId" in sourceState)) {
                this.state = {
                    mode: "collect",
                    sourceCreepId: nearest.goal.id,
                    destId,
                    sourceDistance: sourceState.sourceDistance + 1,
                    nextEvalTime
                };
            } else {
                throw new Error("Unexpected sourceCollector state.");
            }
        } else
            throw new Error("Unexpected code path.");
        this.pathCache = { targetId: destId, targetPath: nearest.path };
        return true;
    }
    private transitIdle(nextEvalTimeOffset?: number): boolean {
        this.state = { mode: "idle", nextEvalTime: nextEvalTimeOffset ?? (Game.time + _.random(5)) };
        return true;
    }
    private transitDistribute(): boolean {
        const { creep, state } = this;
        if (!creep.store.energy) return false;
        const { room } = creep;
        const reachedMaxPeers = (id: CollectorDestId, maxPeers: number) => {
            const c = getTargetingCollectors(id);
            const peers = c.size - (c.has(this.id) ? 1 : 0);
            return peers >= maxPeers;
        }
        const roomCallback = (roomName: string, costMatrix?: CostMatrix) => {
            const room = Game.rooms[roomName];
            if (!room) {
                this.logger.warning(`Unable to check room ${roomName}.`);
                return false;
            }
            // We ignore provided costMatrix completely.
            // We want to make behavior more consistent.
            const costs = buildRoomCostMatrix(room);
            costs.set(creep.pos.x, creep.pos.y, 0);
            return costs;
        };
        const canTransferEnergyToStructure = (s: CollectorCreepDistributeStructureType): boolean => {
            if (!("store" in s)) return false;
            const freeCap = s.store.getFreeCapacity(RESOURCE_ENERGY);
            const minFreeCap = s instanceof StructureSpawn ? 10 : 0;
            if (freeCap < minFreeCap) return false;
            const targetingCollectors = getTargetingCollectors(s.id);
            // Traffic control.
            if (targetingCollectors.size >= 6) return false;
            const incomingEnergy = _([...targetingCollectors]).map(id => Game.getObjectById(id)?.store.energy || 0).sum();
            return incomingEnergy < freeCap;
        }
        if (state.mode === "distribute") {
            // Keep incremental state update if current is already in distribute state.
            const reEvaluatePath = (target: StructureController | ConstructionSite | CollectorCreepDistributeStructureType) => {
                this.pathCache = {
                    targetId: target.id,
                    targetPath: creep.pos.findPathTo(target.pos, {
                        maxRooms: 1,
                        costCallback: (n, c) => roomCallback(n, c) || c,
                        plainCost: 2,
                        swampCost: 6,
                    })
                };
            }
            if ("controllerId" in state) {
                const c = Game.getObjectById(state.controllerId);
                if (c?.my) {
                    reEvaluatePath(c);
                    return true;
                }
            } else if ("constructionSiteId" in state) {
                const s = Game.getObjectById(state.constructionSiteId);
                if (s && s.progress < s.progressTotal) {
                    reEvaluatePath(s);
                    return true;
                }
            } else if ("structureId" in state) {
                const st = Game.getObjectById(state.structureId);
                const minFreeCap = st instanceof StructureSpawn ? 10 : 0;
                if (st && ("store" in st && st.store.getFreeCapacity(RESOURCE_ENERGY) > minFreeCap || structureNeedsRepair(st))) {
                    reEvaluatePath(st);
                    return true;
                }
            }
        }
        const structures = _(room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_EXTENSION && s.my
                || s.structureType === STRUCTURE_TOWER && s.my
                || s.structureType === STRUCTURE_RAMPART && s.my
                || s.structureType === STRUCTURE_SPAWN && s.my
                || s.structureType === STRUCTURE_ROAD
                || s.structureType === STRUCTURE_WALL
                || s.structureType === STRUCTURE_CONTAINER
                || s.structureType === STRUCTURE_STORAGE
        }))
            .map(s => ({
                structure: s as CollectorCreepDistributeStructureType,
                needsRepair: structureNeedsRepair(s),
                storeVacancy: "store" in s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            }))
            .filter(e => !!e.needsRepair || e.storeVacancy)
            .value();
        const towers = structures.filter((s) => s.structure instanceof StructureTower);
        const { controller } = room;
        let controllerPriority: number;
        if (controller?.my) {
            if (!reachedMaxPeers(controller.id, 1) || controller.ticksToDowngrade <= 3600 && !reachedMaxPeers(controller.id, 4)) {
                // Resetting downgrade timer is priority.
                controllerPriority = 1;
            } else if (!reachedMaxPeers(controller.id, 6)) {
                controllerPriority = 0.2;
            } else if (!reachedMaxPeers(controller.id, 10)) {
                controllerPriority = 0.05;
            } else {
                controllerPriority = 0;
            }
        } else {
            controllerPriority = 0;
        }
        const nextEvalTime = Game.time + _.random(4, 10);
        if (controllerPriority === 0 || controllerPriority < 1 && _.random(true) > controllerPriority) {
            let goals;
            if (towers.length && _(towers).map(t => creep.pos.getRangeTo(t.structure)).min()! < 20) {
                // Feeding tower is top priority.
                goals = towers.map(e => e.structure) as CollectorCreepDistributeStructureType[];
            } else {
                // We consider structures in urgent need of fixing first.
                const priorityStructures = structures.filter(s => (
                    s.structure instanceof StructureSpawn
                    || s.structure instanceof StructureExtension
                ) && canTransferEnergyToStructure(s.structure)).map(s => s.structure);
                const fixableStructures = structures
                    .filter(e => e.needsRepair === "now" && !reachedMaxPeers(e.structure.id, 6))
                    .map(e => e.structure);
                const constructionSites = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.progress < s.progressTotal });
                goals = [
                    ...priorityStructures,
                    ...fixableStructures,
                    ...constructionSites,
                ];
            }
            let nearest = findNearestPath<CollectorCreepDistributeDestType>(creep.pos, goals, {
                maxRooms: 1,
                roomCallback: roomCallback,
                plainCost: 2,
                swampCost: 6,
            });
            if (!nearest) {
                // No goal.
                this.logger.info(`transitDistribute: No primary goal.`);
                // Try some no-so-urgent stuff
                let targetGroups: [label: string, possibility: number, structures: { structure: CollectorCreepDistributeStructureType }[]][] = [
                    ["energy sink", 3, structures.filter(e =>
                        e.structure.structureType !== STRUCTURE_STORAGE
                        && e.structure.structureType !== STRUCTURE_CONTAINER
                        && canTransferEnergyToStructure(e.structure))],
                    ["fixable structure", 4, structures.filter(e => e.needsRepair === "yes")],
                    ["low-pri fixable structure", 2, _(structures).filter(e => e.needsRepair === "later").sampleSize(10).value()],
                    ["energy storage", 1, structures.filter(e => e.structure.structureType == STRUCTURE_STORAGE)],
                ];
                targetGroups = targetGroups.filter(([, , sts]) => sts.length);
                while (targetGroups.length) {
                    const possibilityCumSum = [0];
                    for (const [, pos] of targetGroups) {
                        possibilityCumSum.push(_(possibilityCumSum).last()! + pos);
                    }
                    const pos = _.random(true) * _(possibilityCumSum).last()!;
                    const groupIndex = _.range(0, targetGroups.length).find(i => possibilityCumSum[i] <= pos && possibilityCumSum[i + 1] > pos);
                    const group = targetGroups[groupIndex ?? 0];
                    const [name, , sts] = group;
                    // this.logger.warning(`${pos}/${_(possibilityCumSum).last()!} --> ${targetGroups.map(g => `${g[0]}: ${g[1]}`)} --> ${group[0]}`);
                    nearest = findNearestPath(creep.pos, sts.map(s => s.structure), {
                        maxRooms: 1,
                        roomCallback: roomCallback,
                        plainCost: 2,
                        swampCost: 6,
                    });
                    if (nearest) {
                        this.logger.info(`transitDistribute: Found secondary goal (${name}).`);
                        break;
                    } else {
                        targetGroups.remove(group);
                    }
                }
                if (!nearest) return false;
            }
            const destId = nearest.goal.id as Id<any>;
            this.logger.info(`Distribute ${nearest.goal}.`);
            if (nearest.goal instanceof ConstructionSite)
                this.state = { mode: "distribute", constructionSiteId: nearest.goal.id, destId, nextEvalTime };
            else
                this.state = { mode: "distribute", structureId: nearest.goal.id as Id<any>, destId, nextEvalTime };
            this.pathCache = { targetId: destId, targetPath: nearest.path };
            return true;
        }
        if (controller?.my) {
            this.state = { mode: "distribute", controllerId: controller.id, destId: controller.id, nextEvalTime }
            this.pathCache = {
                targetId: controller.id,
                targetPath: creep.pos.findPathTo(controller.pos, {
                    maxRooms: 1,
                    costCallback: (n, c) => roomCallback(n, c) || c,
                    plainCost: 2,
                    swampCost: 6,
                })
            };
            return true;
        }
        return false;
    }
    private checkEnergyConstraint(): boolean {
        const { creep, state } = this;
        switch (state.mode) {
            case "idle":
                return true;
            case "collect":
                if (!creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
                    this.logger.trace("Reached max energy cap. transitDistribute.");
                    this.transitDistribute() || this.transitIdle();
                    return false;
                }
                return true;
            case "distribute":
                if (!creep.store.energy) {
                    this.transitCollect() || this.transitIdle();
                    return false;
                }
                return true;
            default:
                throw new Error("Invalid state.");
        }
    }
    private nextFrameIdle(): void {
        const { creep, state } = this;
        if (state.mode !== "idle") throw new Error("Invalid state.");
        if (Game.time < state.nextEvalTime) {
            creep.say(`Idle${state.nextEvalTime - Game.time}`);
            return;
        }
        const usedCap = creep.store.getUsedCapacity();
        const energy = creep.store.energy;
        const totalCap = creep.store.getCapacity();
        if (usedCap / totalCap < 0.2 && this.transitCollect())
            return;
        if ((usedCap / totalCap > 0.15 || usedCap - energy > 0) && this.transitDistribute())
            return;
        this.transitIdle();
        creep.say("IdleStil");
    }
    private nextFrameCollect(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "collect") throw new Error("Invalid state.");
        let result;
        let dest;
        if ("resourceId" in state) {
            const resource = dest = Game.getObjectById(state.resourceId);
            result = resource ? creep.pickup(resource) : undefined;
            this.logger.trace(`nextFrameCollect: creep.pickup -> ${result}.`);
        } else if ("storageId" in state) {
            const storage = dest = Game.getObjectById(state.storageId);
            result = storage ? creep.withdraw(storage, RESOURCE_ENERGY) : undefined;
            this.logger.trace(`nextFrameCollect: creep.withdraw -> ${result}.`);
        } else if ("sourceCreepId" in state) {
            const sc = dest = Game.getObjectById(state.sourceCreepId);
            const scollector = sc && getSpecializedCreep(sc, CollectorCreep);
            const scstate = scollector?.state;
            if (scstate?.mode == "collect" && "sourceDistance" in scstate && scstate.sourceDistance < state.sourceDistance) {
                if (!sc) {
                    result = undefined;
                } else if (sc.store.energy >= 5) {
                    result = sc ? sc.transfer(creep, RESOURCE_ENERGY) : undefined;
                    this.logger.trace(`nextFrameCollect: ${sc}.transfer(creep) -> ${result}.`);
                } else {
                    this.logger.info(`nextFrameCollect: sourceCreep ${sc} energy is exhausted.`);
                    if (!this.transitCollect())
                        this.transitIdle();
                    return
                }
            } else {
                // In case peer changed source.
                result = undefined;
                this.logger.info(`nextFrameCollect: sourceCreep ${sc} changed source: mode=${scstate?.mode}.`);
            }
        } else {
            const source = dest = Game.getObjectById(state.sourceId);
            if (source) {
                result = creep.harvest(source);
                this.logger.trace(`nextFrameCollect: creep.harvest -> ${result}.`);
            } else {
                result = undefined;
            }
        }
        state.isWalking = result === ERR_NOT_IN_RANGE;
        if (result == null || result === ERR_NOT_IN_RANGE || result === ERR_NOT_ENOUGH_RESOURCES) {
            if (
                // Dest is gone.
                !dest
                // Need to prepare next path.
                || Game.time >= state.nextEvalTime && (!creep.fatigue || creep.fatigue <= 4 && _.random(4) === 0)
                // Transient cache lost.
                || this.pathCache?.targetId !== dest.id) {
                if (!this.transitCollect()) {
                    this.transitIdle();
                    return;
                }
            }
            if (!creep.fatigue) {
                if (!this.pathCache) throw new Error("Assertion failure.");
                if (this.pathCache.targetPath.length) {
                    const moveResult = creep.moveByPath(this.pathCache.targetPath);
                    if (moveResult !== OK) {
                        this.logger.warning(`nextFrameCollect: creep.moveByPath(${dest}) -> ${moveResult}.`);
                        if (moveResult === ERR_NOT_FOUND) {
                            this.logger.trace(`pathCache: ${JSON.stringify(this.pathCache)}.`);
                            this.transitCollect();
                        }
                    }
                } else if (dest && dest.id === this.pathCache.targetId && this.creep.pos.inRangeTo(dest, 1)) {
                    creep.say("Wait Regn");
                } else {
                    this.logger.warning(`Unexpected empty targetPath in pathCache. dest: ${dest}.`);
                }
            }
            return;
        }
    }
    private nextFrameDistribute(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "distribute") throw new Error("Invalid state.");
        let result;
        let dest;
        if ("constructionSiteId" in state) {
            const constructionSite = dest = Game.getObjectById(state.constructionSiteId);
            result = constructionSite ? creep.build(constructionSite) : undefined;
            this.logger.trace(`nextFrameDistribute: creep.build -> ${result}.`);
        } else if ("structureId" in state) {
            const st = dest = Game.getObjectById(state.structureId);
            if (!st) {
                result = undefined
            } else {
                const needsRepair = st && structureNeedsRepair(st);
                const freeCap = "store" in st ? st.store.getFreeCapacity(RESOURCE_ENERGY) : 0;
                if (needsRepair === "now" || needsRepair && !freeCap) {
                    // Fix construct, if it needs fixing or we have more energy.
                    result = creep.repair(st);
                    this.logger.trace(`nextFrameDistribute: creep.repair(${st}) -> ${result}.`);
                } else {
                    result = creep.transfer(st, RESOURCE_ENERGY);
                    this.logger.trace(`nextFrameDistribute: creep.transfer -> ${result}.`);
                }
            }
        } else {
            const controller = dest = Game.getObjectById(state.controllerId);
            result = controller ? creep.upgradeController(controller) : undefined;
            this.logger.trace(`nextFrameDistribute: creep.upgradeController -> ${result}.`);
        }
        state.isWalking = result === ERR_NOT_IN_RANGE;
        if (result == null || result === ERR_NOT_IN_RANGE || result == ERR_INVALID_TARGET) {
            if (
                // Dest is gone.
                !dest
                // Need to prepare next path.
                || Game.time >= state.nextEvalTime && (!creep.fatigue || creep.fatigue <= 4 && _.random(4) === 0)
                // Transient cache lost.
                || this.pathCache?.targetId !== dest.id) {
            } {
                // Recheck nearest spawn / controller.
                if (!this.transitDistribute()) {
                    this.transitIdle();
                    return;
                }
            }
            if (!creep.fatigue) {
                if (!this.pathCache) throw new Error("Assertion failure.");
                if (this.pathCache.targetPath.length) {
                    const moveResult = creep.moveByPath(this.pathCache.targetPath);
                    if (moveResult !== OK) {
                        this.logger.warning(`nextFrameDistribute: creep.moveByPath(${dest}) -> ${moveResult}.`);
                        creep.room.visual.rect(creep.pos.x, creep.pos.y, 1, 1, { fill: "#ff0000" });
                    }
                }
            }
            return;
        } if (result === ERR_NOT_ENOUGH_RESOURCES) {
            if (!this.transitCollect)
                this.transitIdle();
            return;
        }
        if (result === ERR_FULL) {
            if (creep.store.energy > 25 && this.transitDistribute()) return;
            if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && this.transitCollect()) return;
            this.transitIdle();
            return;
        }
    }
}
