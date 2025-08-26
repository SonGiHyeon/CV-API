-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "pseudoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_pseudoId_key" ON "public"."User"("pseudoId");
