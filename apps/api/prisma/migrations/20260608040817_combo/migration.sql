-- AlterTable
ALTER TABLE "product" ADD COLUMN     "combo_category_id" UUID,
ADD COLUMN     "combo_size" INTEGER;

-- CreateTable
CREATE TABLE "order_item_option" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_option_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_item_option_order_item_id_idx" ON "order_item_option"("order_item_id");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_combo_category_id_fkey" FOREIGN KEY ("combo_category_id") REFERENCES "product_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_option" ADD CONSTRAINT "order_item_option_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
