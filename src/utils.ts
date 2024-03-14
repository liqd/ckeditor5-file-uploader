/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module image/imageupload/utils
 */

/* global fetch, File */

import type { ViewElement } from 'ckeditor5/src/engine';
import * as mime from 'mime';

/**
 * Creates a regular expression used to test for image files.
 *
 * ```ts
 * const imageType = createImageTypeRegExp( [ 'png', 'jpeg', 'svg+xml', 'vnd.microsoft.icon' ] );
 *
 * console.log( 'is supported image', imageType.test( file.type ) );
 * ```
 */
export function createFileTypeRegExp( types: Array<string> ): RegExp {
	// Sanitize the MIME type name which may include: "+", "-" or ".".
	const regExpSafeNames = types.flatMap( type => {
		const safeType = type.replace( '+', '\\+' );
		const mimeType = mime.getType( safeType );
		if ( mimeType ) {
			return [ mimeType ];
		}
		return [];
	} );

	return new RegExp( `^${ regExpSafeNames.join( '|' ) }$` );
}

/**
 * Creates a promise that fetches the file local source (Base64 or blob) and resolves with a `File` object.
 *
 * @param file File whose source to fetch.
 * @returns A promise which resolves when an file source is fetched and converted to a `File` instance.
 * It resolves with a `File` object. If there were any errors during file processing, the promise will be rejected.
 */
export function fetchLocalFile( file: ViewElement ): Promise<File> {
	return new Promise( ( resolve, reject ) => {
		const fileSrc = file.getAttribute( 'href' )!;

		// Fetch works asynchronously and so does not block browser UI when processing data.
		fetch( fileSrc )
			.then( resource => resource.blob() )
			.then( blob => {
				const mimeType = getFileMimeType( blob, fileSrc );
				const ext = mimeType.replace( 'file/', '' );
				const filename = `file.${ ext }`;
				const file = new File( [ blob ], filename, { type: mimeType } );
				resolve( file );
			} )
			.catch( err => {
				// Fetch fails only, if it can't make a request due to a network failure or if anything prevented the request
				// from completing, i.e. the Content Security Policy rules. It is not possible to detect the exact cause of failure,
				// so we are just trying the fallback solution, if general TypeError is thrown.
				reject( err );
			} );
	} );
}

/**
 * Checks whether a given node is an file element with a local source (Base64 or blob).
 *
 * @param node The node to check.
 */
export function isLocalFile( node: ViewElement ): boolean {
	if ( !node.is( 'element', 'a' ) || !node.getAttribute( 'href' ) ) {
		return false;
	}

	return !!node.getAttribute( 'href' ); }

/**
 * Extracts an file type based on its blob representation or its source.
 * @param blob file blob representation.
 * @param src file `href` attribute value.
 */
function getFileMimeType( blob: Blob, src: string ): string {
	if ( blob.type ) {
		return blob.type;
	} else if ( src.match( /data:(image\/\w+);base64/ ) ) {
		return src.match( /data:(image\/\w+);base64/ )![ 1 ].toLowerCase();
	} else {
		throw new Error( 'Failed to determine mime type for file.' );
	}
}
