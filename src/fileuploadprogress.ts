/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module image/imageupload/imageuploadprogress
 */

/* globals setTimeout */

import { Plugin } from 'ckeditor5/src/core';
import { FileRepository, type FileLoader } from 'ckeditor5/src/upload';

import '../theme/fileuploadprogress.css';
import '../theme/fileuploadicon.css';
import '../theme/fileuploadloader.css';
import type { GetCallback } from 'ckeditor5/src/utils';
import type {
	DowncastWriter,
	View,
	ViewElement,
	ViewContainerElement,
	ViewUIElement,
	DowncastAttributeEvent,
	Element
} from 'ckeditor5/src/engine';

/**
 * The image upload progress plugin.
 * It shows a placeholder when the image is read from the disk and a progress bar while the image is uploading.
 */
export default class FileUploadProgress extends Plugin {
	/**
	 * @inheritDoc
	 */
	public static get pluginName() {
		return 'FileUploadProgress' as const;
	}

	/**
	 * @inheritDoc
	 */
	public init(): void {
		const editor = this.editor;
		editor.editing.downcastDispatcher.on<DowncastAttributeEvent>(
			'attribute:uploadStatus:$text',
			this.uploadStatusChange
		);
		editor.conversion
			.for( 'downcast' )
			.attributeToElement( {
				model: 'uploadId',
				view: {
					name: 'a',
					key: 'uploadId'
				}
			} );
	}

	/**
	 * This method is called each time the image `uploadStatus` attribute is changed.
	 *
	 * @param evt An object containing information about the fired event.
	 * @param data Additional information about the change.
	 */
	private uploadStatusChange: GetCallback<DowncastAttributeEvent> = ( evt, data, conversionApi ) => {
		const editor = this.editor;
		const modelFile = data.item as Element;
		const uploadId = modelFile.getAttribute( 'uploadId' ) as string | number;

		if ( !conversionApi.consumable.consume( data.item, evt.name ) ) {
			return;
		}
		const fileRepository = editor.plugins.get( FileRepository );
		const status = uploadId ? data.attributeNewValue : null;
		let viewFigure: ViewContainerElement | null = null;
		// selection has no parent, try getting the parent of the first position
		if ( modelFile.is( 'selection' ) ) {
			viewFigure = editor.editing.mapper.toViewElement( modelFile.getFirstPosition()?.parent as Element )! as ViewContainerElement;
		}
		else {
			try {
				let elem: Element | null = modelFile;
				while ( elem && !viewFigure ) {
					viewFigure = editor.editing.mapper.toViewElement( elem )! as ViewContainerElement;
					elem = elem.parent as Element;
				}
			} catch ( e: any ) {
				console.warn( 'couldn\'t find viewFigure' );
			}
		}
		const viewWriter = conversionApi.writer;
		if ( !viewFigure ) {
			return;
		}
		if ( status == 'reading' ) {
			// Start "appearing" effect and show placeholder with infinite progress bar on the top
			// while image is read from disk.
			_startAppearEffect( viewFigure, viewWriter );

			return;
		}

		// Show progress bar on the top of the image when image is uploading.
		if ( status == 'uploading' ) {
			const loader = fileRepository.loaders.get( uploadId );

			// Start appear effect if needed - see https://github.com/ckeditor/ckeditor5-image/issues/191.
			_startAppearEffect( viewFigure, viewWriter );

			if ( loader ) {
				// Initialize progress bar showing upload progress.
				_showProgressBar( viewFigure, viewWriter, loader, editor.editing.view );
			}

			return;
		}

		if ( status == 'complete' && fileRepository.loaders.get( uploadId ) ) {
			_showCompleteIcon( viewFigure, viewWriter, editor.editing.view );
		}

		// Clean up.
		_hideProgressBar( viewFigure, viewWriter );
		_stopAppearEffect( viewFigure, viewWriter );
	};
}

/**
 * Adds ck-appear class to the image figure if one is not already applied.
 */
function _startAppearEffect( viewFigure: ViewContainerElement, writer: DowncastWriter ) {
	if ( !viewFigure.hasClass( 'ck-appear' ) ) {
		writer.addClass( 'ck-appear', viewFigure );
	}
}

/**
 * Removes ck-appear class to the image figure if one is not already removed.
 */
function _stopAppearEffect( viewFigure: ViewContainerElement, writer: DowncastWriter ) {
	writer.removeClass( 'ck-appear', viewFigure );
}

/**
 * Shows progress bar displaying upload progress.
 * Attaches it to the file loader to update when upload percentace is changed.
 */
function _showProgressBar( viewFigure: ViewContainerElement, writer: DowncastWriter, loader: FileLoader, view: View ) {
	const progressBar = _createProgressBar( writer );
	writer.insert( writer.createPositionAt( viewFigure, 'end' ), progressBar );

	// Update progress bar width when uploadedPercent is changed.
	loader.on( 'change:uploadedPercent', ( evt, name, value ) => {
		view.change( writer => {
			writer.setStyle( 'width', value + '%', progressBar );
		} );
	} );
}

/**
 * Hides upload progress bar.
 */
function _hideProgressBar( viewFigure: ViewContainerElement, writer: DowncastWriter ) {
	_removeUIElement( viewFigure, writer, 'progressBar' );
}

/**
 * Shows complete icon and hides after a certain amount of time.
 */
function _showCompleteIcon( viewFigure: ViewContainerElement, writer: DowncastWriter, view: View ) {
	const completeIcon = writer.createUIElement( 'div', { class: 'ck-file-upload-complete-icon' } );

	writer.insert( writer.createPositionAt( viewFigure, 'end' ), completeIcon );

	setTimeout( () => {
		view.change( writer => writer.remove( writer.createRangeOn( completeIcon ) ) );
	}, 3000 );
}

/**
 * Create progress bar element using {@link module:engine/view/uielement~UIElement}.
 */
function _createProgressBar( writer: DowncastWriter ): ViewUIElement {
	const progressBar = writer.createUIElement( 'div', { class: 'ck-progress-bar' } );

	writer.setCustomProperty( 'progressBar', true, progressBar );

	return progressBar;
}

/**
 * Returns {@link module:engine/view/uielement~UIElement} of given unique property from image figure element.
 * Returns `undefined` if element is not found.
 */
function _getUIElement( fileFigure: ViewElement, uniqueProperty: string ): ViewUIElement | undefined {
	for ( const child of fileFigure.getChildren() ) {
		if ( ( child as ViewElement ).getCustomProperty( uniqueProperty ) ) {
			return child as ViewUIElement;
		}
	}
}

/**
 * Removes {@link module:engine/view/uielement~UIElement} of given unique property from image figure element.
 */
function _removeUIElement( viewFigure: ViewContainerElement, writer: DowncastWriter, uniqueProperty: string ) {
	const element = _getUIElement( viewFigure, uniqueProperty );

	if ( element ) {
		writer.remove( writer.createRangeOn( element ) );
	}
}
