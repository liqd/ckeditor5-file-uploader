/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module image/imageupload/imageuploadui
 */

import { type Locale } from 'ckeditor5/src/utils';
// eslint-disable-next-line
import { add } from '@ckeditor/ckeditor5-utils/src/translation-service';
import { Plugin } from 'ckeditor5/src/core';
import { FileDialogButtonView } from 'ckeditor5/src/upload';
import * as mime from 'mime';
import { createFileTypeRegExp } from './utils';
import fileUploadIcon from '../theme/icons/file-arrow-up-solid.svg';
import type UploadFileCommand from './uploadfilecommand';

/**
 * The image upload button plugin.
 *
 * For a detailed overview, check the {@glink features/images/image-upload/image-upload Image upload feature} documentation.
 *
 * Adds the `'uploadImage'` button to the {@link module:ui/componentfactory~ComponentFactory UI component factory}
 * and also the `imageUpload` button as an alias for backward compatibility.
 */
export default class FileUploadUI extends Plugin {
	/**
	 * @inheritDoc
	 */
	public static get pluginName() {
		return 'FileUploadUI' as const;
	}

	/**
	 * @inheritDoc
	 */
	public init(): void {
		// Add translations
		add( 'de', { 'Insert file': 'Datei einfügen' } );
		const editor = this.editor;
		const t = editor.t;
		const componentCreator = ( locale: Locale ) => {
			const view = new FileDialogButtonView( locale );
			const command: UploadFileCommand = editor.commands.get( 'uploadFile' )! as UploadFileCommand;
			const fileTypes = editor.config.get( 'fileUploader.fileTypes' )! as Array<string>;
			const fileTypesRegExp = createFileTypeRegExp( fileTypes );

			view.set( {
				acceptedType: fileTypes.map( type => mime.getType( type ) ).join( ',' ),
				allowMultipleFiles: true
			} );

			view.buttonView.set( {
				label: t( 'Insert file' ),
				icon: fileUploadIcon,
				tooltip: true
			} );

			view.buttonView.bind( 'isEnabled' ).to( command );

			view.on( 'done', ( evt, files: FileList ) => {
				const filesToUpload = Array.from( files ).filter( file => fileTypesRegExp.test( file.type ) );

				if ( filesToUpload.length ) {
					editor.execute( 'uploadFile', { file: filesToUpload } );

					editor.editing.view.focus();
				}
			} );

			return view;
		};

		// Setup `uploadImage` button and add `imageUpload` button as an alias for backward compatibility.
		editor.ui.componentFactory.add( 'uploadFile', componentCreator );
		editor.ui.componentFactory.add( 'fileUpload', componentCreator );
	}
}
