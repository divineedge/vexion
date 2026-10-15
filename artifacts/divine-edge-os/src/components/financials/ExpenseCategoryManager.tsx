import {useState} from 'react';
import {useListExpenseCategories,useCreateExpenseCategory,useRenameExpenseCategory,getListExpenseCategoriesQueryKey} from '@workspace/api-client-react';
import {useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {toast} from 'sonner';
const errorMessage=(error:unknown)=>(error as {data?:{error?:string}})?.data?.error??'Could not save category';

export default function ExpenseCategoryManager(){
 const [open,setOpen]=useState(false),[name,setName]=useState('');
 const query=useListExpenseCategories(),create=useCreateExpenseCategory(),rename=useRenameExpenseCategory(),qc=useQueryClient();
 const refresh=()=>qc.invalidateQueries({queryKey:getListExpenseCategoriesQueryKey()});
 return <>
  <Button type="button" variant="outline" size="sm" onClick={()=>setOpen(true)}>Manage categories</Button>
  <Sheet open={open} onOpenChange={setOpen}>
   <SheetContent className="w-full sm:w-[520px] sm:min-w-0 sm:max-w-[90vw] overflow-y-auto">
    <SheetHeader><SheetTitle>Vendor & expense categories</SheetTitle><SheetDescription>Add categories or change their names. Renaming also updates the labels on existing vendors and expenses without changing their history.</SheetDescription></SheetHeader>
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
     {query.data?.map(category=><CategoryRow key={`${category.key}:${category.name}`} name={category.name} busy={rename.isPending} save={async name=>{
      try{await rename.mutateAsync({key:category.key,data:{name}});await refresh();toast.success('Category renamed');}catch(error){toast.error(errorMessage(error));}
     }}/>)}
    </div>
   </SheetContent>
  </Sheet>
 </>;
}
function CategoryRow({name,busy,save}:{name:string;busy:boolean;save:(name:string)=>Promise<void>}){
 const [draft,setDraft]=useState(name);
 return <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void save(draft.trim());}}>
  <Input aria-label={`Category name: ${name}`} maxLength={100} value={draft} onChange={e=>setDraft(e.target.value)}/>
  <Button type="submit" variant="outline" disabled={busy||!draft.trim()||draft.trim()===name}>Save</Button>
 </form>;
}
