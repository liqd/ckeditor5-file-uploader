import { Plugin } from 'ckeditor5/src/core';
import FileUploadEditing from './fileuploadediting';
import FileUploadUI from './fileuploadui';
import FileUploadProgress from './fileuploadprogress';

export default class FileUploader extends Plugin {
	public static get requires() {
		return [ FileUploadEditing, FileUploadUI, FileUploadProgress ] as const;
	}

	public static get pluginName() {
		return 'FileUploader' as const;
	}
}
