import {useState} from 'react';
import {useListExpenseCategories,useCreateExpenseCategory,useRenameExpenseCategory,getListExpenseCategoriesQueryKey} from '@workspace/api-client-react';
import {useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {toast} from 'sonner';
import {Trash2} from 'lucide-react';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {useDeleteExpenseCategory,ALL_CATEGORIES_KEY} from '@/lib/expenseCategories';
const errorMessage=(error:unknown)=>(error as {data?:{error?:string}})?.data?.error??'Could not save category';

export default function ExpenseCategoryManager(){
 const [open,setOpen]=useState(false),[name,setName]=useState('');
 const query=useListExpenseCategories(),create=useCreateExpenseCategory(),rename=useRenameExpenseCategory(),qc=useQueryClient();
 const refresh=()=>Promise.all([qc.invalidateQueries({queryKey:getListExpenseCategoriesQueryKey()}),qc.invalidateQueries({queryKey:ALL_CATEGORIES_KEY})]);
 const del=useDeleteExpenseCategory();
 const [pending,setPending]=useState<{key:string;name:string}|null>(null);
 const otherName=query.data?.find(c=>c.key==='other')?.name??'Other';
 return <>
  <Button type="button" variant="outline" size="sm" onClick={()=>setOpen(true)}>Manage categories</Button>
  <Sheet open={open} onOpenChange={setOpen}>
   <SheetContent className="w-full sm:w-[520px] sm:min-w-0 sm:max-w-[90vw] overflow-y-auto">
    <SheetHeader><SheetTitle>Vendor & expense categories</SheetTitle><SheetDescription>Add, rename or delete categories. Renaming also updates the labels on existing vendors and expenses without changing their history. Deleted categories stay on past expenses but can't be chosen for new ones.</SheetDescription></SheetHeader>
    <form className="flex gap-2 mt-6" onSubmit={async e=>{
     e.preventDefault();if(!name.trim())return;
     try{await create.mutateAsync({data:{name:name.trim()}});setName('');await refresh();toast.success('Category added');}catch(error){toast.error(errorMessage(error));}
    }}>
     <Input aria-label="New category name" value={name} maxLength={100} placeholder="New category name" onChange={e=>setName(e.target.value)}/>
     <Button disabled={!name.trim()||create.isPending} type="submit">Add</Button>
    </form>
    {query.isLoading&&<p className="mt-4 text-sm">Loading categories…</p>}
    {query.isError&&<Button variant="outline" className="mt-4" onClick={()=>query.refetch()}>Could not load categories. Retry</Button>}
    <div className="space-y-3 mt-5">
     {query.data?.map(category=><CategoryRow key={`${category.key}:${category.name}`} name={category.name} busy={rename.isPending} canDelete={category.key!=='other'} onDelete={()=>setPending(category)} save={async name=>{
      try{await rename.mutateAsync({key:category.key,data:{name}});await refresh();toast.success('Category renamed');}catch(error){toast.error(errorMessage(error));}
     }}/>)}
    </div>
   </SheetContent>
  </Sheet>
  <AlertDialog open={!!pending} onOpenChange={o=>{if(!o)setPending(null);}}>
   <AlertDialogContent>
    <AlertDialogHeader>
     <AlertDialogTitle>Delete category “{pending?.name}”?</AlertDialogTitle>
     <AlertDialogDescription>Past expenses keep this category and its label. Vendors that use it as their default switch to {otherName}. It will no longer be offered for new expenses or vendors.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
     <AlertDialogCancel>Cancel</AlertDialogCancel>
     <AlertDialogAction disabled={del.isPending} data-testid="button-confirm-delete-category" onClick={async e=>{
      e.preventDefault();if(!pending)return;
      try{await del.mutateAsync(pending.key);toast.success('Category deleted');setPending(null);}catch(error){toast.error(errorMessage(error));}
     }}>{del.isPending?'Deleting…':'Delete category'}</AlertDialogAction>
    </AlertDialogFooter>
   </AlertDialogContent>
  </AlertDialog>
 </>;
}
function CategoryRow({name,busy,save,canDelete,onDelete}:{name:string;busy:boolean;save:(name:string)=>Promise<void>;canDelete:boolean;onDelete:()=>void}){
 const [draft,setDraft]=useState(name);
 return <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void save(draft.trim());}}>
  <Input aria-label={`Category name: ${name}`} maxLength={100} value={draft} onChange={e=>setDraft(e.target.value)}/>
  <Button type="submit" variant="outline" disabled={busy||!draft.trim()||draft.trim()===name}>Save</Button>
  {canDelete?<Button type="button" variant="ghost" size="icon" aria-label={`Delete category ${name}`} title="Delete category" onClick={onDelete} data-testid={`button-delete-category-${name}`}><Trash2 className="w-4 h-4 text-destructive"/></Button>
   :<span className="w-9 shrink-0" title="The Other category can't be deleted" aria-hidden/>}
 </form>;
}
