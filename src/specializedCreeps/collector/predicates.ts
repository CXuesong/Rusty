import _ from "lodash/index";
import { CollectorCreepCollectTargetType, CollectorCreepCollectPrimaryTargetType } from "./state";
import { getTargetingCollectors } from "./targetTracking";

const MIN_COLLECTABLE_ENERGY_NEAR = 5;
const AGGRESSIVE_UPGRADE_MODE = true;
const RANGE_DISTANCE_RATIO = 1.6;

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

export function estimateResourceDecayRatio(target: CollectorCreepCollectTargetType, currentPos: RoomPosition): number {
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

export function isCollectableFrom(target: CollectorCreepCollectTargetType, srcPos?: RoomPosition): boolean {
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
