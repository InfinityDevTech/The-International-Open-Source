import { NukeRequestData, RESULT_ACTION, RESULT_NO_ACTION } from 'international/constants'
import { scalePriority } from 'international/utils'
import { CommuneManager } from './commune'

const nukerResources = [RESOURCE_ENERGY, RESOURCE_GHODIUM]

export class NukerManager {
    communeManager: CommuneManager
    nuker: StructureNuker

    constructor(communeManager: CommuneManager) {
        this.communeManager = communeManager
        this.nuker = this.communeManager.room.structures.nuker[0]
    }

    run() {
        const roomMemory = Memory.rooms[this.communeManager.room.name]
        const requestName = roomMemory.NR
        if (!requestName) return

        if (!this.nuker) {
            return
        }

        if (this.createRoomLogisticsRequests() === RESULT_ACTION) return

        const request = Memory.nukeRequests[requestName]
        this.nuker.launchNuke(new RoomPosition(request.data[NukeRequestData.x], request.data[NukeRequestData.y], requestName))
    }

    private createRoomLogisticsRequests() {

        let result = RESULT_NO_ACTION
        
        for (const resource of nukerResources) {
            if (this.nuker.freeReserveStoreOf(resource) <= 0) continue

            this.communeManager.room.createRoomLogisticsRequest({
                target: this.nuker,
                type: 'transfer',
                priority: 100,
            })

            result = RESULT_ACTION
        }

        return result
    }
}
