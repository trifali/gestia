import {
  useQuery,
  useAction,
  getClientFiles,
  createClientFolder,
  uploadClientFile,
  deleteClientFiles,
  renameClientFile,
  moveClientFiles,
  createNewClientFile,
  getClientFileEditorContent,
  updateClientFileContent,
} from 'wasp/client/operations';
import { LuFolderOpen, LuFolderKanban } from 'react-icons/lu';
import { SharedFileManager } from '../projects/SharedFileManager';

interface Props {
  clientId: string;
}

function DriveInfo() {
  return (
    <div className='mb-4 rounded-lg border border-base-200 bg-base-50 px-3 py-2 flex flex-col gap-1 text-xs text-base-content/60'>
      <div className='flex items-center gap-1.5'>
        <LuFolderOpen className='shrink-0 text-primary' size={13} />
        <span><span className='font-medium text-base-content/80'>Drive client</span> — contrats, briefs, visuels de référence, notes internes. Indépendamment des projets.</span>
      </div>
    </div>
  );
}

export function ClientFileManagerTab({ clientId }: Props) {
  const { data: rawFiles, refetch, isFetching } = useQuery(getClientFiles, { clientId });
  const createFolder = useAction(createClientFolder);
  const uploadFile = useAction(uploadClientFile);
  const deleteFiles = useAction(deleteClientFiles);
  const renameFile = useAction(renameClientFile);
  const moveFiles = useAction(moveClientFiles);
  const createFile = useAction(createNewClientFile);
  const updateFileContent = useAction(updateClientFileContent);

  return (
    <>
      <DriveInfo />
      <SharedFileManager
      ops={{
        files: rawFiles as any[] | undefined,
        isFetching,
        refetch,
        upload: ({ dataUrl, name, originalName, parentId }) =>
          uploadFile({ clientId, dataUrl, name, originalName, parentId }),
        createFolder: ({ name, parentId }) =>
          createFolder({ clientId, name, parentId }),
        deleteFiles: ({ ids }) =>
          deleteFiles({ clientId, ids }),
        renameFile: ({ id, name }) =>
          renameFile({ id, name }),
        moveFiles: ({ ids, targetParentId }) =>
          moveFiles({ clientId, ids, targetParentId }),
        createNewFile: ({ name, type, parentId }) =>
          createFile({ clientId, name, type, parentId }),
        getEditorContent: (id) => getClientFileEditorContent({ id }),
        saveFileContent: (id, content, contentType) =>
          updateFileContent({ id, content, contentType }),
        instanceId: `client-${clientId}`,
      }}
    />
    </>
  );
}
