import {
  useQuery,
  useAction,
  getProjectFiles,
  createProjectFolder,
  uploadProjectFile,
  deleteProjectFiles,
  renameProjectFile,
  moveProjectFiles,
  createNewProjectFile,
  getFileEditorContent,
  updateProjectFileContent,
} from 'wasp/client/operations';
import { SharedFileManager } from './SharedFileManager';

interface Props {
  projectId: string;
}

export function ProjectFileManagerTab({ projectId }: Props) {
  const { data: rawFiles, refetch, isFetching } = useQuery(getProjectFiles, { projectId });
  const createFolder = useAction(createProjectFolder);
  const uploadFile = useAction(uploadProjectFile);
  const deleteFiles = useAction(deleteProjectFiles);
  const renameFile = useAction(renameProjectFile);
  const moveFiles = useAction(moveProjectFiles);
  const createFile = useAction(createNewProjectFile);
  const updateFileContent = useAction(updateProjectFileContent);

  return (
    <SharedFileManager
      ops={{
        files: rawFiles as any[] | undefined,
        isFetching,
        refetch,
        upload: ({ dataUrl, name, originalName, parentId }) =>
          uploadFile({ projectId, dataUrl, name, originalName, parentId }),
        createFolder: ({ name, parentId }) =>
          createFolder({ projectId, name, parentId }),
        deleteFiles: ({ ids }) =>
          deleteFiles({ projectId, ids }),
        renameFile: ({ id, name }) =>
          renameFile({ id, name }),
        moveFiles: ({ ids, targetParentId }) =>
          moveFiles({ projectId, ids, targetParentId }),
        createNewFile: ({ name, type, parentId }) =>
          createFile({ projectId, name, type, parentId }),
        getEditorContent: (id) => getFileEditorContent({ id }),
        saveFileContent: (id, content, contentType) =>
          updateFileContent({ id, content, contentType }),
        instanceId: projectId,
      }}
    />
  );
}
