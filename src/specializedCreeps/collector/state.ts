interface CollectorCreepStateBase {
    mode: string;
    isWalking?: boolean;
}

interface CollectorCreepStateIdle extends CollectorCreepStateBase {
    mode: "idle";
    nextEvalTime: number;
}

export type CollectorCreepCollectPrimaryTargetType = Source | Tombstone | Resource;
export type CollectorCreepCollectSecondaryTargetType = Creep | StructureStorage;
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
    | StructureStorage;

export type CollectorCreepDistributeTargetType =
    | ConstructionSite
    | StructureController
    | CollectorCreepDistributeStructureType;

export type CollectorTargetId = Id<RoomObject>;

interface CollectorCreepStateCollect extends CollectorCreepStateBase {
    mode: "collect";
    targetId: Id<CollectorCreepCollectTargetType>;
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
    targetId: Id<CollectorCreepDistributeTargetType>;
    /** Expiry at which the target and path cache can be considered as "invalidated". */
    nextEvalTime: number;
}

interface CollectorCreepStateDistributeStructure extends CollectorCreepStateDistribute {
    structureId: Id<CollectorCreepDistributeStructureType>;
    targetId: Id<CollectorCreepDistributeStructureType>;
}

interface CollectorCreepStateDistributeController extends CollectorCreepStateDistribute {
    controllerId: Id<StructureController>;
    targetId: Id<StructureController>;
}

interface CollectorCreepStateDistributeConstruction extends CollectorCreepStateDistribute {
    constructionSiteId: Id<ConstructionSite>;
    targetId: Id<ConstructionSite>;
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
