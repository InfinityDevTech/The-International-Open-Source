import { minerals, Result, RoomMemoryKeys, terminalResourceTargets } from 'international/constants'
import { customLog, findLargestTransactionAmount, newID, roundTo } from 'utils/utils'
import './marketFunctions'
import {
    simpleAllies,
    AllyRequestTypes,
    ResourceRequest,
} from 'international/simpleAllies'
import { collectiveManager } from 'international/collective'
import { CommuneManager } from 'room/commune/commune'
import { marketUtils } from './marketFunctions'

export class TerminalManager {
    communeManager: CommuneManager
    room: Room
    terminal: StructureTerminal

    constructor(communeManager: CommuneManager) {
        this.communeManager = communeManager
    }

    preTickRun() {
        const { terminal } = this.communeManager.room
        if (!terminal) return
        if (!terminal.RCLActionable) return

        this.createTerminalRequests()
    }

    run() {
        const { room } = this.communeManager
        const { terminal } = room

        // Stop if there is no terminal

        if (!terminal) return
        if (!terminal.RCLActionable) return
        if (terminal.cooldown > 0) return

        if (this.respondToTerminalRequests()) return
        if (this.respondToAllyRequests()) return

        // Check if the market is disabled by us or the server

        if (!global.settings.marketUsage) return
        if (!collectiveManager.marketIsFunctional) return

        this.manageResources()
    }

    private createTerminalRequests() {
        const { room } = this.communeManager
        const { terminal } = room

        for (const key in terminalResourceTargets) {
            const resource = key as ResourceConstant
            const resourceTarget = terminalResourceTargets[resource]
            let targetAmount = resourceTarget.min(this.communeManager)
            if (targetAmount <= 0) continue
            if (resourceTarget.conditions && !resourceTarget.conditions(this.communeManager))
                continue

            // We have enough

            const storedResourceAmount =
                this.communeManager.room.resourcesInStoringStructures[resource] || 0
            if (storedResourceAmount >= targetAmount) continue

            targetAmount = Math.floor(targetAmount * 1.1)
            const priority = roundTo(1 - storedResourceAmount / targetAmount, 2)
            const amount = Math.min(
                targetAmount - storedResourceAmount,
                terminal.store.getFreeCapacity(),
            )

            const ID = newID()

            collectiveManager.terminalRequests[ID] = {
                priority,
                resource: resource,
                amount,
                roomName: room.name,
            }
        }
    }

    private findBestTerminalRequest(): [TerminalRequest, string, number] {
        const budget = Math.min(
            this.communeManager.room.resourcesInStoringStructures.energy -
                this.communeManager.minStoredEnergy,
            this.communeManager.room.terminal.store[RESOURCE_ENERGY],
        )

        let lowestScore = Infinity
        let bestRequestID: string
        let bestRequest: TerminalRequest
        let amount: number

        for (const ID in collectiveManager.terminalRequests) {
            const request = collectiveManager.terminalRequests[ID]

            // Don't respond to requests for this room

            if (request.roomName === this.communeManager.room.name) continue

            // Ensure we have more than the asking amount

            const newAmount = findLargestTransactionAmount(
                budget,
                Math.min(
                    request.amount,
                    this.communeManager.room.resourcesInStoringStructures[request.resource] -
                        terminalResourceTargets[request.resource]?.min(this.communeManager) || 0,
                ),
                this.communeManager.room.name,
                request.roomName,
            )
            if (newAmount / request.amount < 0.25) continue

            const score =
                Game.map.getRoomLinearDistance(this.communeManager.room.name, request.roomName) +
                request.priority * 100
            if (score >= lowestScore) continue

            amount = newAmount
            bestRequest = request
            bestRequestID = ID
            lowestScore = score
        }

        return [bestRequest, bestRequestID, amount]
    }

    private respondToTerminalRequests() {
        // We don't have enough energy to help other rooms

        if (
            this.communeManager.room.resourcesInStoringStructures.energy <
            this.communeManager.minStoredEnergy
        )
            return false

        const [request, ID, amount] = this.findBestTerminalRequest()
        if (!request) return false

        this.communeManager.room.terminal.send(
            request.resource,
            amount,
            request.roomName,
            'Terminal request',
        )
        delete collectiveManager.terminalRequests[ID]
        this.communeManager.room.terminal.intended = true
        return true
    }

    private findBestAllyRequest(): [ResourceRequest, string, number] {
        const budget = Math.min(
            this.communeManager.room.resourcesInStoringStructures.energy -
                this.communeManager.minStoredEnergy,
            this.communeManager.room.terminal.store[RESOURCE_ENERGY],
        )

        let lowestScore = Infinity
        let bestRequest: ResourceRequest
        let bestRequestID: string
        let amount: number

        // Filter out allyRequests that are requesting resources

        const resourceRequests = simpleAllies.allySegmentData.requests.resource

        for (const ID in resourceRequests) {
            const request = resourceRequests[ID]

            // Ensure we have more than the asking amount

            const newAmount = findLargestTransactionAmount(
                budget,
                Math.min(
                    request.amount,
                    this.communeManager.room.resourcesInStoringStructures[request.resourceType] -
                        terminalResourceTargets[request.resourceType]?.min(this.communeManager) ||
                        0,
                ),
                this.communeManager.room.name,
                request.roomName,
            )
            if (newAmount / request.amount < 0.25) continue

            const score =
                Game.map.getRoomLinearDistance(this.communeManager.room.name, request.roomName) +
                request.priority * 100
            if (score >= lowestScore) continue

            amount = newAmount
            bestRequest = request
            bestRequestID = ID
            lowestScore = score
        }

        return [bestRequest, bestRequestID, amount]
    }

    private respondToAllyRequests() {
        if (!global.settings.allyCommunication) return Result.noAction
        if (!simpleAllies.allySegmentData) return Result.noAction
        if (!simpleAllies.allySegmentData.requests) return Result.noAction

        // We don't have enough energy to help other rooms

        if (
            this.communeManager.room.resourcesInStoringStructures.energy <
            this.communeManager.minStoredEnergy
        )
            return false

        const [request, ID, amount] = this.findBestAllyRequest()
        if (!request) return Result.noAction

        this.communeManager.room.terminal.send(
            request.resourceType,
            amount,
            request.roomName,
            'Ally request',
        )
        this.communeManager.room.terminal.intended = true

        // Remove the request so other rooms don't try to respond to it

        delete simpleAllies.allySegmentData.requests.resource[ID]
        return Result.action
    }

    private manageResources() {
        const { room } = this.communeManager
        const { terminal } = room

        for (const key in terminalResourceTargets) {
            const resource = key as ResourceConstant
            const resourceTarget = terminalResourceTargets[resource]
            if (resourceTarget.conditions && !resourceTarget.conditions(this.communeManager))
                continue

            let min = resourceTarget.min(this.communeManager)

            // We don't have enough

            if (terminal.store[resource] < min) {
                if (Game.market.credits < collectiveManager.minCredits) continue

                min *= 1.2

                if (marketUtils.advancedBuy(room, resource, min - terminal.store[resource], min)) return
                continue
            }

            let max = resourceTarget.max(this.communeManager)

            // We have enough

            if (terminal.store[resource] < max) continue

            max *= 0.8

            // Try to sell the excess amount

            if (marketUtils.advancedSell(room, resource, terminal.store[resource] - max, max)) return
        }
    }
}
