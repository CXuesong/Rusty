export interface CollectorCreepOperationBase {
    opName: string;
}

interface CollectorCreepOperationIdle extends CollectorCreepOperationBase {
    opName: "idle";
    nextEvalTime: number;
}

export type CollectorCreepCollectPrimaryTargetType = Source | Tombstone | Ruin | Resource;
export type CollectorCreepCollectSecondaryTargetType = Creep | StructureLink | StructureStorage;
export type CollectorCreepCollectTargetType = CollectorCreepCollectPrimaryTargetType | CollectorCreepCollectSecondaryTargetType;

// General structure: has hit point, may store energy.
export type CollectorCreepDistributeStructureType =
    | StructureSpawn
    | StructureExtension
    | StructureTower
    | StructureRampart
    | StructureRoad
    | StructureWall
    | StructureContainer
    | StructureStorage
    | StructureLink;

export type CollectorCreepDistributeTargetType =
    | ConstructionSite
    | StructureController
    | CollectorCreepDistributeStructureType;

export type CollectorTargetId = Id<RoomObject>;

interface CollectorCreepStateCollect extends CollectorCreepOperationBase {
    opName: "collect";
    targetId: Id<CollectorCreepCollectTargetType>;
    /** Expiry at which the target and path cache can be considered as "invalidated". */
    nextEvalTime: number;
}

interface CollectorCreepOperationCollectSource extends CollectorCreepStateCollect {
    readonly sourceId: Id<Source>;
    sourceDistance: 0;
}

// Resource dropped.
interface CollectorCreepOperationCollectResource extends CollectorCreepStateCollect {
    readonly resourceId: Id<Resource>;
}

interface CollectorCreepOperationCollectCreepRelay extends CollectorCreepStateCollect {
    readonly sourceCreepId: Id<Creep>;
    sourceDistance: number;
}

interface CollectorCreepOperationCollectStorage extends CollectorCreepStateCollect {
    readonly storageId: Id<StructureStorage | StructureLink | Tombstone | Ruin>;
    sourceDistance: 0;
}

interface CollectorCreepStateDistribute extends CollectorCreepOperationBase {
    opName: "distribute";
    targetId: Id<CollectorCreepDistributeTargetType>;
    /** Expiry at which the target and path cache can be considered as "invalidated". */
    nextEvalTime: number;
}

interface CollectorCreepOperationDistributeStructure extends CollectorCreepStateDistribute {
    structureId: Id<CollectorCreepDistributeStructureType>;
    targetId: Id<CollectorCreepDistributeStructureType>;
}

interface CollectorCreepOperationDistributeController extends CollectorCreepStateDistribute {
    controllerId: Id<StructureController>;
    targetId: Id<StructureController>;
}

interface CollectorCreepOperationDistributeConstruction extends CollectorCreepStateDistribute {
    constructionSiteId: Id<ConstructionSite>;
    targetId: Id<ConstructionSite>;
}

export type CollectorCreepOperation
    = CollectorCreepOperationIdle
    | CollectorCreepOperationCollectSource
    | CollectorCreepOperationCollectResource
    | CollectorCreepOperationCollectCreepRelay
    | CollectorCreepOperationCollectStorage
    | CollectorCreepOperationDistributeStructure
    | CollectorCreepOperationDistributeController
    | CollectorCreepOperationDistributeConstruction;

export type CollectorCreepTimedOperation = CollectorCreepOperation & {
    /** Operation start time. */
    startTime: number;
}

export type CollectorCreepEndTimedOperation = CollectorCreepTimedOperation & {
    /** Operation end time. */
    endTime: number;
}

export interface CollectorCreepState {
    isWalking?: boolean;
    operation: CollectorCreepTimedOperation
    /** Prevent creeps from transferring resource in / out immediately. */
    recentOperations: CollectorCreepEndTimedOperation[];
}
