import { ProductEditor } from "@/components/admin/ProductEditor";

export default function EditProductPage({ params }: { params: { id: string } }) {
  return <ProductEditor mode="edit" productId={params.id} />;
}