import { categoriesRouter } from "@/modules/categories/server/procedures";
import { createTRPCRouter } from "../init";

// import { TRPCError } from "@trpc/server";
export const appRouter = createTRPCRouter({
  categories: categoriesRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;
