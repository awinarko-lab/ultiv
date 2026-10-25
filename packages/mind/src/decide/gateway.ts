/**
 * The seam to the Jev decision model. Narrow on purpose: everything the mind
 * does with Jev goes through one call, so tests substitute the gateway and
 * the real client stays at the edge.
 */
import {
  TypeSafeClient,
  type EntryType,
  type Questions,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

export interface JevGateway {
  systemOne<const Q extends Questions>(request: {
    readonly state: NonNullable<EntryType>;
    readonly questions: Q;
  }): Promise<SystemOneResult<Q>>;
}

/** The real gateway: a Typesafe.AI client pinned to a default model. */
export const typesafeGateway = (client: TypeSafeClient): JevGateway => ({
  systemOne: (request) => client.systemOne(request),
});
