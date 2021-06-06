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
export type CollectorCreepDistributeStructureType =
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
