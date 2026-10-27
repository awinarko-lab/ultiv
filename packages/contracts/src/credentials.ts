import { Type, type Static } from "typebox";

/**
 * Credential bindings: which vault item an adapter may use, where, and how.
 * The broker is protocol-generic (`adapter`); HTTP is the first adapter, and
 * ssh/git/SMTP/IMAP/DB/env adapters add their own literals later. A binding
 * holds no secret bytes: only the policy around one sealed vault item.
 */
export const CredentialAdapterSchema = Type.Union([Type.Literal("http")]);

export type CredentialAdapter = Static<typeof CredentialAdapterSchema>;

/** Where the HTTP adapter places the secret on a request. */
export const HttpAuthPlacementSchema = Type.Union([
  Type.Literal("bearer"),
  Type.Literal("basic"),
  Type.Literal("header"),
  Type.Literal("query"),
  Type.Literal("body"),
]);

export type HttpAuthPlacement = Static<typeof HttpAuthPlacementSchema>;

export const HttpMethodSchema = Type.Union([
  Type.Literal("GET"),
  Type.Literal("HEAD"),
  Type.Literal("POST"),
  Type.Literal("PUT"),
  Type.Literal("PATCH"),
  Type.Literal("DELETE"),
]);

export type HttpMethod = Static<typeof HttpMethodSchema>;

/** The editable part of a binding (the Vault screen's form). */
export const CredentialBindingInputSchema = Type.Object({
  adapter: CredentialAdapterSchema,
  /**
   * Allowed targets: a hostname (`api.github.com`), a subdomain wildcard
   * (`*.example.com`), `host:port`, or an https URL prefix
   * (`https://api.example.com/v1/`).
   */
  hosts: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { minItems: 1, maxItems: 20 }),
  methods: Type.Array(HttpMethodSchema, { minItems: 1 }),
  auth: Type.Object({
    placement: HttpAuthPlacementSchema,
    /** Header name (header), query parameter (query) or JSON field (body). */
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    /** Optional value prefix for `header` placement, e.g. `Token `. */
    prefix: Type.Optional(Type.String({ maxLength: 40 })),
  }),
  /** Profiles (bots) that may use it; null = every profile the item is visible to. */
  profiles: Type.Union([Type.Array(Type.String()), Type.Null()]),
  /** Plain http to localhost/127.0.0.1/[::1] only; everything else is https. */
  allowLocalhostHttp: Type.Boolean(),
});

export type CredentialBindingInput = Static<typeof CredentialBindingInputSchema>;

export const CredentialBindingSchema = Type.Intersect([
  CredentialBindingInputSchema,
  Type.Object({
    itemId: Type.String(),
    /** Hosts the owner already approved this credential on (first-use cards). */
    approvedHosts: Type.Array(Type.String()),
    updatedAt: Type.Number(),
  }),
]);

export type CredentialBinding = Static<typeof CredentialBindingSchema>;

export const CredentialBindingListSchema = Type.Array(CredentialBindingSchema);

export type CredentialBindingList = Static<typeof CredentialBindingListSchema>;
