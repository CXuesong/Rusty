import _ from "lodash/index";
import { CollectorCreepCollectTargetType } from "./state";
import { getTargetingCollectors } from "./targetTracking";

export type RoomConstructionMode = 'minimal' | 'balanced' | 'fort';

const MIN_COLLECTABLE_ENERGY_NEAR = 5;
const RANGE_DISTANCE_RATIO = 2;

export function getRoomConstructionMode(room: Room): RoomConstructionMode {
    if (!room.controller || room.controller.level <= 3) return 'minimal';
    if (room.controller.progressTotal == null) return 'fort';
    return 'balanced';
}

export function structureNeedsRepair(structure: Structure): "now" | "yes" | "later" | false {
    // some WALL does not have hitsMax
    if (!structure.hitsMax || structure.hits >= structure.hitsMax) return false;
    const constructionMode = getRoomConstructionMode(structure.room);
    if (structure instanceof StructureRampart) {
        let params: [placementRatio: number, spawnPlacementRatio: number, base: number, h1: number, h2: number, h3: number];
        switch (constructionMode) {
            case 'minimal':
                params = [2, 2, 5000, 1, 2, 6];
                break;
            case 'fort':
                params = [8, 16, 5000, 1, 6, 12];
                break;
            default:
                params = [2, 3, 5000, 1, 6, 12];
                break;
        }
        const [pr, spr, b, h1, h2, h3] = params;
        // hits per hour
        // 3600 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME = 15,800
        const hph = 3600 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME
        if (structure.hits < b + h1 * hph) return "now";
        const structures = structure.pos.lookFor(LOOK_STRUCTURES);
        const anySpawn = structures.find(s => s.structureType === STRUCTURE_SPAWN);
        const anyStructure = anySpawn || structures.find(s =>
            s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_ROAD)
        const placementRatio = anySpawn ? spr : anyStructure ? pr : 1;
        if (structure.hits < b + placementRatio * h2 * hph) return "yes";
        if (structure.hits < b + placementRatio * h3 * hph) return "later";
        return false;
    }
    if (structure instanceof StructureWall) {
        let params: [h1k: number, h2k: number, h3k: number];
        switch (constructionMode) {
            case 'minimal':
                params = [30, 50, 100];
                break;
            case 'fort':
                params = [500, 1000, 50000];
                break;
            default:
                params = [50, 500, 1000];
                break;
        }
        if (structure.hits < params[0] * 1000) return "now";
        if (structure.hits < params[1] * 1000) return "yes";
        if (structure.hits < params[2] * 1000) return "later";
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

export function estimateResourceDecayRatio(target: CollectorCreepCollectTargetType, currentPos: RoomPosition): number {
    const eta = target.pos.getRangeTo(currentPos) * RANGE_DISTANCE_RATIO;
    if (target instanceof Resource) {
        return Math.pow(1 - 1 / ENERGY_DECAY, eta);
    }
    if (target instanceof Tombstone || target instanceof Ruin) {
        const decayTime = eta - target.ticksToDecay;
        return decayTime > 0 ? Math.pow(1 - 1 / ENERGY_DECAY, eta) : 1;
    }
    return 1;
}

export function estimateCollectableAmount(target: CollectorCreepCollectTargetType, srcPos?: RoomPosition): number {
    const decayRatio = srcPos ? estimateResourceDecayRatio(target, srcPos) : 1;
    if ("store" in target) return (_(target.store).values().sum() || 0) * decayRatio;
    if (target instanceof Resource) return target.amount * decayRatio;
    if (target instanceof Source) {
        if (srcPos && target.ticksToRegeneration < srcPos.getRangeTo(target) * RANGE_DISTANCE_RATIO)
            return target.energyCapacity;
        return target.energy;
    }
    throw new TypeError("Unexpected target type.");
}

export function isCollectableFrom(target: CollectorCreepCollectTargetType, srcPos?: RoomPosition): boolean {
    const decayRatio = srcPos ? estimateResourceDecayRatio(target, srcPos) : 1;
    let storeInfo: { energy: number; rest: number; maxCollectors: number; };
    if ("store" in target) {
        storeInfo = {
            energy: target.store.energy * decayRatio,
            rest: ((_(target.store).values().sum() || 0) - target.store.energy) * decayRatio,
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
    const { energy: energyAmount, rest: restAmount, maxCollectors } = storeInfo;
    const minCollectableEnergy = !srcPos || srcPos.inRangeTo(target, 2) ? MIN_COLLECTABLE_ENERGY_NEAR : MIN_COLLECTABLE_ENERGY_NEAR;
    const minCollectableOtherResource = 1;
    if (energyAmount < minCollectableEnergy && restAmount < minCollectableOtherResource) return false;
    const targetingCollectors = getTargetingCollectors(target.id);
    // Traffic control.
    if (targetingCollectors.size >= maxCollectors) return false;
    const collectorCap = _([...targetingCollectors]).map(id => Game.getObjectById(id)?.store.getFreeCapacity() || 0).sum();
    return collectorCap < energyAmount + restAmount;
}

export function canStorageAcceptEnergy(storage: StructureStorage): boolean {
    return storage.store.getFreeCapacity(RESOURCE_ENERGY) / storage.store.getCapacity(RESOURCE_ENERGY) < 0.3;
}
