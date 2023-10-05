/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

import type { Writer } from 'ckeditor5/src/engine';
import { findOptimalInsertionRange } from 'ckeditor5/src/widget';
import { FileRepository } from 'ckeditor5/src/upload';
import { Command } from 'ckeditor5/src/core';
import { toArray, type ArrayOrItem } from 'ckeditor5/src/utils';

/**
 * @module image/imageupload/uploadimagecommand
 */

/**
 * The upload image command.
 *
 * The command is registered by the {@link module:image/imageupload/imageuploadediting~ImageUploadEditing} plugin as `uploadImage`
 * and it is also available via aliased `imageUpload` name.
 *
 * In order to upload an image at the current selection position
 * (according to the {@link module:widget/utils~findOptimalInsertionRange} algorithm),
 * execute the command and pass the native image file instance:
 *
 * ```ts
 * this.listenTo( editor.editing.view.document, 'clipboardInput', ( evt, data ) => {
 * 	// Assuming that only images were pasted:
 * 	const images = Array.from( data.dataTransfer.files );
 *
 * 	// Upload the first image:
 * 	editor.execute( 'uploadImage', { file: images[ 0 ] } );
 * } );
 * ```
 *
 * It is also possible to insert multiple images at once:
 *
 * ```ts
 * editor.execute( 'uploadImage', {
 * 	file: [
 * 		file1,
 * 		file2
 * 	]
 * } );
 * ```
 */
export default class UploadFileCommand extends Command {
	/**
	 * @inheritDoc
	 */
	public override refresh(): void {
		// TODO: This needs refactoring.
		this.isEnabled = true;
	}

	/**
	 * Executes the command.
	 *
	 * @fires execute
	 * @param options Options for the executed command.
	 * @param options.file The image file or an array of image files to upload.
	 */
	public override execute( options: { file: ArrayOrItem<File> } ): void {
		const files = toArray( options.file );
		const selection = this.editor.model.document.selection;

		// In case of multiple files, each file (starting from the 2nd) will be inserted at a position that
		// follows the previous one. That will move the selection and, to stay on the safe side and make sure
		// all images inherit the same selection attributes, they are collected beforehand.
		//
		// Applying these attributes ensures, for instance, that inserting an (inline) image into a link does
		// not split that link but preserves its continuity.
		//
		// Note: Selection attributes that do not make sense for images will be filtered out by insertImage() anyway.
		const selectionAttributes = Object.fromEntries( selection.getAttributes() );

		files.forEach( file => {
			this._uploadFile( file, selectionAttributes );
		} );
	}

	/**
	 * Handles uploading single file.
	 */
	private _uploadFile( file: File, attributes: object ): void {
		const editor = this.editor;
		const fileRepository = editor.plugins.get( FileRepository );
		const loader = fileRepository.createLoader( file );

		// Do not throw when upload adapter is not set. FileRepository will log an error anyway.
		if ( !loader ) {
			return;
		}

		this._insertFile( file, { ...attributes, linkHref: '', uploadId: loader.id } );
	}

	/**
	* Handles inserting single file. This method unifies file insertion using {@link module:widget/utils~findOptimalInsertionRange}
	* method.
	*
	* @param attributes Attributes of the inserted file.
	* This method filters out the attributes which are disallowed by the {@link module:engine/model/schema~Schema}.
	* @param selectable Place to insert the file. If not specified,
	* the {@link module:widget/utils~findOptimalInsertionRange} logic will be applied for the file.
	*
	* **Note**: If `selectable` is passed, this helper will not be able to set selection attributes (such as `linkHref`)
	* and apply them to the new file. In this case, make sure all selection attributes are passed in `attributes`.
	*
	* @param fileType File type of inserted file. If not specified,
	* it will be determined automatically depending of editor config or place of the insertion.
	* @return The inserted model file element.
	*/
	private _insertFile(
		file: File,
		attributes: Record<string, unknown> = {}
	): Element | null {
		const model = this.editor.model;
		const selection = model.document.selection;

		// Mix declarative attributes with selection attributes because the new image should "inherit"
		// the latter for best UX. For instance, inline images inserted into existing links
		// should not split them. To do that, they need to have "linkHref" inherited from the selection.
		attributes = {
			...Object.fromEntries( selection.getAttributes() ),
			...attributes
		};

		for ( const attributeName in attributes ) {
			if ( !model.schema.checkAttribute( '$text', attributeName ) ) {
				delete attributes[ attributeName ];
			}
		}

		return model.change( ( writer: Writer ): Element | null => {
			const fileElement = writer.createText( file.name, attributes );
			const insertAtSelection = findOptimalInsertionRange( selection, model );
			model.insertContent( fileElement, insertAtSelection );
			return null;
		} );
	}
}
