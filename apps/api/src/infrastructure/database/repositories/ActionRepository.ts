import type { IActionRepository } from '../../../domain/repositories/interfaces.js';
import type { ActionProposal, ActionValidation, ProvenanceRef } from '../../../domain/entities/types.js';
import prisma from '../prisma.js';

export class PrismaActionRepository implements IActionRepository {
  async findProposalById(id: string): Promise<ActionProposal | null> {
    const p = await prisma.actionProposal.findUnique({ where: { id } });
    if (!p) return null;
    return {
      ...p,
      parameters: p.parameters as Record<string, unknown>,
      provenanceChain: p.provenanceChain as unknown as ProvenanceRef[],
    };
  }

  async createProposal(
    data: Omit<ActionProposal, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ActionProposal> {
    const p = await prisma.actionProposal.create({
      data: {
        operation: data.operation,
        description: data.description,
        parameters: data.parameters as never,
        impactedEntityIds: data.impactedEntityIds,
        sourceId: data.sourceId,
        branchId: data.branchId,
        provenanceChain: data.provenanceChain as never,
        status: data.status,
      },
    });
    return {
      ...p,
      parameters: p.parameters as Record<string, unknown>,
      provenanceChain: p.provenanceChain as unknown as ProvenanceRef[],
    };
  }

  async updateProposal(id: string, data: Partial<ActionProposal>): Promise<ActionProposal> {
    const p = await prisma.actionProposal.update({
      where: { id },
      data: data as never,
    });
    return {
      ...p,
      parameters: p.parameters as Record<string, unknown>,
      provenanceChain: p.provenanceChain as unknown as ProvenanceRef[],
    };
  }

  async createValidation(
    data: Omit<ActionValidation, 'id' | 'createdAt'>,
  ): Promise<ActionValidation> {
    const v = await prisma.actionValidation.create({
      data: {
        actionProposalId: data.actionProposalId,
        admissibility: data.admissibility,
        deltaPhi: data.deltaPhi,
        psiScore: data.psiScore,
        constraintViolationRisk: data.constraintViolationRisk,
        dependencyBreakageRisk: data.dependencyBreakageRisk,
        contradictionAmplification: data.contradictionAmplification,
        uncertaintyExposure: data.uncertaintyExposure,
        provenanceFragility: data.provenanceFragility,
        propagatedRisk: data.propagatedRisk,
        impactedEntityIds: data.impactedEntityIds,
        provenanceChain: data.provenanceChain as never,
        reasons: data.reasons,
      },
    });
    return {
      ...v,
      provenanceChain: v.provenanceChain as unknown as ProvenanceRef[],
    };
  }

  async findValidationsByProposalId(proposalId: string): Promise<ActionValidation[]> {
    const items = await prisma.actionValidation.findMany({
      where: { actionProposalId: proposalId },
      orderBy: { createdAt: 'desc' },
    });
    return items.map(v => ({
      ...v,
      provenanceChain: v.provenanceChain as unknown as ProvenanceRef[],
    }));
  }

  async findAll({ limit = 20, status }: { limit?: number; status?: string } = {}): Promise<ActionProposal[]> {
    const items = await prisma.actionProposal.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return items.map(p => ({
      ...p,
      parameters: p.parameters as Record<string, unknown>,
      provenanceChain: p.provenanceChain as unknown as ProvenanceRef[],
    }));
  }
}
