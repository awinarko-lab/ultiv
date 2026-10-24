import { hostNamed, method, remote } from "@earendil-works/chord";
import { Type } from "typebox";

export const Ping = remote("ultiv.ping", {
  version: 1,
  input: Type.Object({ name: Type.String() }),
  host: hostNamed("server"),
  variants: {
    default: {
      state: { count: Type.Number() },
      methods: { increment: method(Type.Object({ by: Type.Number() })) },
    },
  },
});
