/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module image/imageupload/imageuploadediting
 */

import { Plugin, type Editor } from 'ckeditor5/src/core';

import {
	UpcastWriter,
	type Element,
	type Item,
	type DataTransfer,
	type ViewElement
} from 'ckeditor5/src/engine';

import { Notification } from 'ckeditor5/src/ui';
import { ClipboardPipeline, type ViewDocumentClipboardInputEvent } from 'ckeditor5/src/clipboard';
import { FileRepository, type UploadResponse, type FileLoader } from 'ckeditor5/src/upload';

import UploadFileCommand from './uploadfilecommand';
import { createFileTypeRegExp, fetchLocalFile, isLocalFile } from './utils';

/**
 * The editing part of the file upload feature. It registers the `'uploadFile'` command
 * and the `fileUpload` command as an aliased name.
 *
 * When a file is uploaded, it fires the {@link ~FileUploadEditing#event:uploadComplete `uploadComplete`} event
 * that allows adding custom attributes to the {@link module:engine/model/element~Element file element}.
 */
export default class FileUploadEditing extends Plugin {
	/**
	 * @inheritDoc
	 */
	public static get requires() {
		return [ FileRepository, Notification, ClipboardPipeline ] as const;
	}

	public static get pluginName() {
		return 'FileUploadEditing' as const;
	}

	/**
	 * An internal mapping of {@link module:upload/filerepository~FileLoader#id file loader UIDs} and
	 * model elements during the upload.
	 *
	 * Model element of the uploaded image can change, for instance, when {@link module:image/image/imagetypecommand~ImageTypeCommand}
	 * is executed as a result of adding caption or changing image style. As a result, the upload logic must keep track of the model
	 * element (reference) and resolve the upload for the correct model element (instead of the one that landed in the `$graveyard`
	 * after image type changed).
	 */
	private readonly _uploadFileElements: Map<string, Element>;

	/**
	 * @inheritDoc
	 */
	constructor( editor: Editor ) {
		super( editor );

		editor.config.define( 'fileUploader', {
			fileTypes: [ 'pdf' ]
		} );

		this._uploadFileElements = new Map();
	}

	/**
	 * @inheritDoc
	 */
	public init(): void {
		const editor = this.editor;
		const doc = editor.model.document;
		const conversion = editor.conversion;
		const fileRepository = editor.plugins.get( FileRepository );
		const clipboardPipeline: ClipboardPipeline = editor.plugins.get( 'ClipboardPipeline' );
		const fileTypes = createFileTypeRegExp( editor.config.get( 'fileUploader.fileTypes' )! as Array<string> );
		const uploadFileCommand = new UploadFileCommand( editor );
		const schema = editor.model.schema;

		// Register `uploadFile` command.
		editor.commands.add( 'uploadFile', uploadFileCommand );

		schema.extend( '$text', {
			allowAttributes: [ 'uploadId', 'uploadStatus' ]
		} );

		// Register upcast converter for uploadId.
		conversion.for( 'upcast' )
			.attributeToAttribute( {
				view: {
					name: 'a',
					key: 'uploadId'
				},
				model: 'uploadId'
			} );

		// conversion.for( 'downcast' ).attributeToElement( {
		//	model: 'uploadId',
		//	view: {
		//		name: 'a',
		//		key: 'uploadId'
		//	}
		// } );

		// Handle pasted files.
		// For every image file, a new file loader is created and a placeholder image is
		// inserted into the content. Then, those images are uploaded once they appear in the model
		// (see Document#change listener below).
		this.listenTo<ViewDocumentClipboardInputEvent>( editor.editing.view.document, 'clipboardInput', ( evt, data ) => {
			// Skip if non empty HTML data is included.
			// https://github.com/ckeditor/ckeditor5-upload/issues/68
			if ( isHtmlIncluded( data.dataTransfer ) ) {
				return;
			}

			const files = Array.from( data.dataTransfer.files ).filter( file => {
				// See https://github.com/ckeditor/ckeditor5-image/pull/254.
				if ( !file ) {
					return false;
				}

				return fileTypes.test( file.type );
			} );

			if ( !files.length ) {
				return;
			}

			evt.stop();

			editor.model.change( writer => {
				// Set selection to paste target.
				if ( data.targetRanges ) {
					writer.setSelection( data.targetRanges.map( viewRange => editor.editing.mapper.toModelRange( viewRange ) ) );
				}

				editor.execute( 'uploadFile', { file: files } );
			} );
		} );

		// Handle HTML pasted with images with base64 or blob sources.
		// For every image file, a new file loader is created and a placeholder image is
		// inserted into the content. Then, those images are uploaded once they appear in the model
		// (see Document#change listener below).
		this.listenTo( clipboardPipeline, 'inputTransformation', ( evt, data ) => {
			const fetchableFiles = Array.from( editor.editing.view.createRangeIn( data.content ) )
				.map( value => value.item as ViewElement )
				.filter( viewElement =>
					isLocalFile( viewElement ) &&
					!viewElement.getAttribute( 'uploadProcessed' ) )
				.map( viewElement => { return { promise: fetchLocalFile( viewElement ), fileElement: viewElement }; } );

			if ( !fetchableFiles.length ) {
				return;
			}

			const writer = new UpcastWriter( editor.editing.view.document );

			for ( const fetchableFile of fetchableFiles ) {
				// Set attribute marking that the image was processed already.
				writer.setAttribute( 'uploadProcessed', true, fetchableFile.fileElement );

				const loader = fileRepository.createLoader( fetchableFile.promise );

				if ( loader ) {
					writer.setAttribute( 'href', '', fetchableFile.fileElement );
					writer.setAttribute( 'uploadId', loader.id, fetchableFile.fileElement );
				}
			}
		} );

		// Prevents from the browser redirecting to the dropped image.
		editor.editing.view.document.on( 'dragover', ( evt, data ) => {
			data.preventDefault();
		} );

		// Upload placeholder images that appeared in the model.
		doc.on( 'change', () => {
			// Note: Reversing changes to start with insertions and only then handle removals. If it was the other way around,
			// loaders for **all** images that land in the $graveyard would abort while in fact only those that were **not** replaced
			// by other images should be aborted.
			const changes = doc.differ.getChanges( { includeChangesInGraveyard: true } ).reverse();
			const insertedFileIds = new Set();

			for ( const entry of changes ) {
				if ( entry.type == 'insert' ) {
					const item = entry.position.nodeAfter!;
					const isInsertedInGraveyard = entry.position.root.rootName == '$graveyard';

					if ( !item ) {
						continue;
					}

					for ( const fileElement of getFilesFromChangeItem( editor, item ) ) {
						// Check if the image element still has upload id.
						const uploadId = fileElement.getAttribute( 'uploadId' ) as string;

						if ( !uploadId ) {
							continue;
						}

						// Check if the image is loaded on this client.
						const loader = fileRepository.loaders.get( uploadId );

						if ( !loader ) {
							continue;
						}

						if ( isInsertedInGraveyard ) {
							// If the image was inserted to the graveyard for good (**not** replaced by another image),
							// only then abort the loading process.
							if ( !insertedFileIds.has( uploadId ) ) {
								loader.abort();
							}
						} else {
							// Remember the upload id of the inserted image. If it acted as a replacement for another
							// image (which landed in the $graveyard), the related loader will not be aborted because
							// this is still the same image upload.
							insertedFileIds.add( uploadId );

							// Keep the mapping between the upload ID and the image model element so the upload
							// can later resolve in the context of the correct model element. The model element could
							// change for the same upload if one image was replaced by another (e.g. image type was changed),
							// so this may also replace an existing mapping.
							this._uploadFileElements.set( uploadId, fileElement as Element );

							if ( loader.status == 'idle' ) {
								// If the image was inserted into content and has not been loaded yet, start loading it.
								this._readAndUpload( loader );
							}
						}
					}
				}
			}
		} );

		// Set the default handler for feeding the image element with `src` and `srcset` attributes.
		// Also set the natural `width` and `height` attributes (if not already set).
		this.on<FileUploadCompleteEvent>( 'uploadComplete', ( evt, { fileElement, data } ) => {
			const urls = data.urls ? data.urls as Record<string, unknown> : data;

			this.editor.model.change( writer => {
				writer.setAttribute( 'linkHref', urls.default, fileElement );
			} );
		}, { priority: 'low' } );
	}

	/**
	 * Reads and uploads a file.
	 *
	 * The image is read from the disk and as a Base64-encoded string it is set temporarily to
	 * `image[src]`. When the image is successfully uploaded, the temporary data is replaced with the target
	 * image's URL (the URL to the uploaded image on the server).
	 */
	protected _readAndUpload( loader: FileLoader ): Promise<void> {
		const editor = this.editor;
		const model = editor.model;
		const t = editor.locale.t;
		const fileRepository = editor.plugins.get( FileRepository );
		const notification = editor.plugins.get( Notification );
		const fileUploadElements = this._uploadFileElements;

		model.enqueueChange( { isUndoable: false }, writer => {
			writer.setAttribute( 'uploadStatus', 'reading', fileUploadElements.get( loader.id )! );
		} );

		return loader.read()
			.then( () => {
				const promise = loader.upload();
				const fileElement = fileUploadElements.get( loader.id )!;

				model.enqueueChange( { isUndoable: false }, writer => {
					writer.setAttribute( 'uploadStatus', 'uploading', fileElement );
				} );

				return promise;
			} )
			.then( data => {
				model.enqueueChange( { isUndoable: false }, writer => {
					const fileElement = fileUploadElements.get( loader.id )!;

					writer.setAttribute( 'uploadStatus', 'complete', fileElement );

					this.fire<FileUploadCompleteEvent>( 'uploadComplete', { data, fileElement } );
				} );

				clean();
			} )
			.catch( error => {
				// If status is not 'error' nor 'aborted' - throw error because it means that something else went wrong,
				// it might be generic error and it would be real pain to find what is going on.
				if ( loader.status !== 'error' && loader.status !== 'aborted' ) {
					throw error;
				}

				// Might be 'aborted'.
				if ( loader.status == 'error' && error ) {
					notification.showWarning( error, {
						title: t( 'Upload failed' ),
						namespace: 'upload'
					} );
				}

				// Permanently remove image from insertion batch.
				model.enqueueChange( { isUndoable: false }, writer => {
					writer.remove( fileUploadElements.get( loader.id )! );
				} );

				clean();
			} );

		function clean() {
			model.enqueueChange( { isUndoable: false }, writer => {
				const fileElement = fileUploadElements.get( loader.id )!;

				writer.removeAttribute( 'uploadId', fileElement );
				writer.removeAttribute( 'uploadStatus', fileElement );

				fileUploadElements.delete( loader.id );
			} );

			fileRepository.destroyLoader( loader );
		}
	}
}

/**
 * Returns `true` if non-empty `text/html` is included in the data transfer.
 */
export function isHtmlIncluded( dataTransfer: DataTransfer ): boolean {
	return Array.from( dataTransfer.types ).includes( 'text/html' ) && dataTransfer.getData( 'text/html' ) !== '';
}

function getFilesFromChangeItem( editor: Editor, item: Item ): Array<Item> {
	return Array.from( editor.model.createRangeOn( item ) )
		.filter( value => value.item.hasAttribute( 'linkHref' ) )
		.map( value => value.item );
}

/**
 * An event fired when an image is uploaded. You can hook into this event to provide
 * custom attributes to the {@link module:engine/model/element~Element image element} based on the data from
 * the server.
 *
 * ```ts
 * const imageUploadEditing = editor.plugins.get( 'ImageUploadEditing' );
 *
 * imageUploadEditing.on( 'uploadComplete', ( evt, { data, imageElement } ) => {
 * 	editor.model.change( writer => {
 * 		writer.setAttribute( 'someAttribute', 'foo', imageElement );
 * 	} );
 * } );
 * ```
 *
 * You can also stop the default handler that sets the `src` and `srcset` attributes
 * if you want to provide custom values for these attributes.
 *
 * ```ts
 * imageUploadEditing.on( 'uploadComplete', ( evt, { data, imageElement } ) => {
 * 	evt.stop();
 * } );
 * ```
 *
 * **Note**: This event is fired by the {@link module:image/imageupload/imageuploadediting~ImageUploadEditing} plugin.
 *
 * @eventName ~ImageUploadEditing#uploadComplete
 * @param data The `uploadComplete` event data.
 */
export type FileUploadCompleteEvent = {
	name: 'uploadComplete';
	args: [ data: FileUploadCompleteData];
};

export type FileUploadCompleteData = {

	/**
	 * The data coming from the upload adapter.
	 */
	data: UploadResponse;

	/**
	 * The model {@link module:engine/model/element~Element image element} that can be customized.
	 */
	fileElement: Element;
};
