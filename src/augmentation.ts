import type { FileUploader } from './index';

declare module '@ckeditor/ckeditor5-core' {
	interface PluginsMap {
		[ FileUploader.pluginName ]: FileUploader;
	}
}
